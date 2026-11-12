/**
 * Layer rules for dependency-cruiser.
 *
 *   core <- sources <- extraction <- store <- engines <- api
 *
 * Clients (the CLI now, a local server and UI later) reach the engine only
 * through its package entry point. The same rules are enforced a second time
 * by the ESLint rule in tools/eslint-plugin-orglens.js.
 */
const { layers, salesforceLayer, salesforcePackages, clientForbiddenPackages } = require('./layers.cjs');

const escape = (text) => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const layerPath = (layer) => `^packages/engine/src/${layer}/`;
const anyLayer = `^packages/engine/src/(${layers.join('|')})/`;
const entryPoint = '^packages/engine/src/index\\.ts$';
/** Matches a package by name whether or not it could be resolved to node_modules. */
const packagePath = (names) => `(^|node_modules/)(${names.map(escape).join('|')})(/|$)`;

const forbidden = [
  { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  {
    name: 'not-to-unresolvable',
    comment: 'An import that cannot be resolved cannot be checked against the layer rules.',
    severity: 'error',
    from: {},
    to: { couldNotResolve: true },
  },
  {
    name: 'clients-use-engine-api-only',
    comment: 'Clients may import the engine only through its package entry point.',
    severity: 'error',
    from: { path: '^packages/(?!engine/)' },
    to: { path: '^packages/engine/', pathNot: '^packages/engine/(src|dist)/index\\.(ts|js|d\\.ts)$' },
  },
  {
    name: 'clients-never-use-store-or-parsers',
    comment: 'Clients reach data only through the engine API.',
    severity: 'error',
    from: { path: '^packages/(?!engine/)' },
    to: { path: packagePath(clientForbiddenPackages) },
  },
  {
    name: 'engine-never-imports-clients',
    severity: 'error',
    from: { path: '^packages/engine/' },
    to: { path: '^packages/(?!engine/)' },
  },
  {
    name: 'salesforce-sdk-only-in-sources',
    comment: `Only the ${salesforceLayer} layer of the engine talks to Salesforce.`,
    severity: 'error',
    from: { pathNot: layerPath(salesforceLayer) },
    to: { path: packagePath(salesforcePackages) },
  },
  {
    name: 'layers-never-import-the-entry-point',
    comment: 'A layer importing the engine entry point would reach the api layer through the back door.',
    severity: 'error',
    from: { path: anyLayer },
    to: { path: entryPoint },
  },
  {
    name: 'engine-source-only-in-layers',
    comment: 'packages/engine/src holds only the layer folders and index.ts.',
    severity: 'error',
    from: {},
    to: { path: '^packages/engine/src/', pathNot: [anyLayer, entryPoint] },
  },
  {
    name: 'engine-source-only-in-layers-outbound',
    comment: 'packages/engine/src holds only the layer folders and index.ts.',
    severity: 'error',
    from: { path: '^packages/engine/src/', pathNot: [anyLayer, entryPoint] },
    to: {},
  },
];

layers.forEach((layer, index) => {
  const later = layers.slice(index + 1);
  if (later.length > 0) {
    forbidden.push({
      name: `layer-${layer}-no-forward-imports`,
      comment: `${layer} must not import from a later layer (${later.join(', ')}).`,
      severity: 'error',
      from: { path: layerPath(layer) },
      to: { path: later.map(layerPath) },
    });
  }
});

module.exports = {
  forbidden,
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['/dist/', '/test/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['@sf-orglens/source', 'import', 'types', 'default'],
      extensions: ['.ts', '.js'],
    },
  },
};
