/*
 * ESLint rule that enforces the OrgLens layer rules.
 *
 * It resolves every relative import to a real path before judging it, so it
 * cannot be bypassed with `./../api/x.ts` and does not misfire on a folder
 * inside one layer that happens to share a name with another layer. It looks
 * at static imports, re-exports, `import()` expressions, `import('x')` types
 * and `require('x')` calls with a literal argument.
 *
 * The rules, which mirror `.dependency-cruiser.cjs`:
 *   - a layer never imports from a later layer, nor from the engine entry point;
 *   - `packages/engine/src` holds only the layer folders and `index.ts`;
 *   - the engine never imports a client package, nor itself by package name;
 *   - a client imports the engine only by its package name, without a subpath;
 *   - only the `sources` layer imports the Salesforce libraries;
 *   - a client never imports the database driver or the XML parser.
 */
import path from 'node:path';
import layering from '../layers.cjs';

const { layers, salesforceLayer, salesforcePackages, clientForbiddenPackages, enginePackage } = layering;

const ENGINE_SRC = 'packages/engine/src';
const ENGINE_ENTRY = `${ENGINE_SRC}/index.ts`;

const toPosix = (value) => value.split(path.sep).join('/');
const matchesPackage = (specifier, name) => specifier === name || specifier.startsWith(`${name}/`);

/** Describes where a repository-relative path sits in the architecture. */
function classify(file) {
  if (file === ENGINE_ENTRY) return { kind: 'engine-entry' };
  if (file.startsWith(`${ENGINE_SRC}/`)) {
    const layer = file.slice(ENGINE_SRC.length + 1).split('/')[0];
    const nested = file.slice(ENGINE_SRC.length + 1).includes('/');
    return nested && layers.includes(layer) ? { kind: 'layer', layer } : { kind: 'engine-stray' };
  }
  if (file.startsWith('packages/engine/')) return { kind: 'engine-other' };
  if (file.startsWith('packages/')) return { kind: 'client' };
  return { kind: 'outside' };
}

const messages = {
  forwardImport: 'The {{from}} layer must not import from the later {{to}} layer.',
  entryImport: 'A layer must not import the engine entry point. Import from the layer that owns the code.',
  strayFile: 'packages/engine/src may contain only the layer folders ({{layers}}) and index.ts.',
  strayImport: 'Engine code must live in a layer folder. "{{target}}" is outside all of them.',
  engineImportsClient: 'The engine must never import from a client package.',
  engineSelfImport: 'Engine code must not import the engine by its package name.',
  clientInternalImport: 'Clients use only the public engine API: import from "{{enginePackage}}" and nothing below it.',
  salesforceImport: 'Only the {{layer}} layer of the engine may import the Salesforce libraries.',
  clientForbiddenImport: 'Clients never use "{{specifier}}" directly. They reach data only through the engine API.',
};

const layersRule = {
  meta: {
    type: 'problem',
    docs: { description: 'Enforce the OrgLens layer rules.' },
    schema: [],
    messages,
  },
  create(context) {
    const file = toPosix(path.relative(context.cwd, context.filename));
    const origin = classify(file);
    if (origin.kind === 'outside') return {};
    const inEngineSource = origin.kind === 'layer' || origin.kind === 'engine-entry' || origin.kind === 'engine-stray';

    function checkRelative(node, specifier) {
      const targetFile = toPosix(path.normalize(path.join(path.dirname(file), specifier)));
      // An import of a folder or of a file without extension is judged by the same path.
      const target = classify(
        targetFile === ENGINE_SRC || targetFile === `${ENGINE_SRC}/index` ? ENGINE_ENTRY : targetFile,
      );

      if (origin.kind === 'client') {
        if (target.kind !== 'client' && target.kind !== 'outside') {
          context.report({ node, messageId: 'clientInternalImport', data: { enginePackage } });
        }
        return;
      }
      if (!inEngineSource) return;
      if (target.kind === 'client') {
        context.report({ node, messageId: 'engineImportsClient' });
      } else if (target.kind === 'engine-stray') {
        context.report({ node, messageId: 'strayImport', data: { target: targetFile } });
      } else if (origin.kind === 'layer' && target.kind === 'engine-entry') {
        context.report({ node, messageId: 'entryImport' });
      } else if (
        origin.kind === 'layer' &&
        target.kind === 'layer' &&
        layers.indexOf(target.layer) > layers.indexOf(origin.layer)
      ) {
        context.report({ node, messageId: 'forwardImport', data: { from: origin.layer, to: target.layer } });
      }
    }

    function checkPackage(node, specifier) {
      if (salesforcePackages.some((name) => matchesPackage(specifier, name))) {
        const allowed = origin.kind === 'engine-other' || (origin.kind === 'layer' && origin.layer === salesforceLayer);
        if (!allowed) context.report({ node, messageId: 'salesforceImport', data: { layer: salesforceLayer } });
        return;
      }
      if (matchesPackage(specifier, enginePackage)) {
        if (inEngineSource) {
          context.report({ node, messageId: 'engineSelfImport' });
        } else if (origin.kind === 'client' && specifier !== enginePackage) {
          context.report({ node, messageId: 'clientInternalImport', data: { enginePackage } });
        }
        return;
      }
      if (origin.kind === 'client' && clientForbiddenPackages.some((name) => matchesPackage(specifier, name))) {
        context.report({ node, messageId: 'clientForbiddenImport', data: { specifier } });
      }
    }

    function check(sourceNode) {
      if (!sourceNode) return;
      const specifier =
        sourceNode.type === 'Literal'
          ? sourceNode.value
          : sourceNode.type === 'TemplateLiteral' && sourceNode.expressions.length === 0
            ? sourceNode.quasis[0].value.cooked
            : undefined;
      if (typeof specifier !== 'string') return;
      if (specifier.startsWith('.')) checkRelative(sourceNode, specifier);
      else checkPackage(sourceNode, specifier);
    }

    return {
      Program(node) {
        if (origin.kind === 'engine-stray') {
          context.report({
            node,
            loc: { line: 1, column: 0 },
            messageId: 'strayFile',
            data: { layers: layers.join(', ') },
          });
        }
      },
      ImportDeclaration: (node) => check(node.source),
      ExportNamedDeclaration: (node) => check(node.source),
      ExportAllDeclaration: (node) => check(node.source),
      ImportExpression: (node) => check(node.source),
      TSImportEqualsDeclaration: (node) => check(node.moduleReference?.expression),
      TSImportType: (node) => check(node.source ?? node.argument?.literal ?? node.argument),
      CallExpression(node) {
        if (node.callee.type === 'Identifier' && node.callee.name === 'require') check(node.arguments[0]);
      },
    };
  },
};

export default { meta: { name: 'eslint-plugin-orglens' }, rules: { layers: layersRule } };
