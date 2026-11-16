/**
 * A source that a test writes: files of objects, fields and validation rules by path, and the components they
 * make up. The tests of the analysis use it for what the fixture project does not have.
 */
import { buildKey, type ComponentKey } from '../../src/core/keys.ts';
import type { Reference } from '../../src/core/references.ts';
import { analyseSource, type SourceAnalysis } from '../../src/extraction/analyse.ts';
import type { AnalysisIssue } from '../../src/extraction/analysed.ts';
import type { ResolvedComponent } from '../../src/sources/resolve.ts';
import type { SourceTree } from '../../src/sources/tree.ts';

export const key = (type: string, fullName: string): ComponentKey => buildKey({ type, fullName });

/** How the source names the target of a reference, as the reference keeps it. */
export const viaOf = (reference: Reference): string => {
  const via = reference.attrs?.['via'];
  return typeof via === 'string' ? via : 'none';
};

/** The issues of an analysis as `severity CODE`. */
export const codes = (issues: readonly AnalysisIssue[]): string[] =>
  issues.map((issue) => `${issue.severity} ${issue.code}`);

export const XMLNS = 'http://soap.sforce.com/2006/04/metadata';
export const HEAD = '<?xml version="1.0" encoding="UTF-8"?>';
export const xml = (root: string, ...lines: string[]): string =>
  [HEAD, `<${root} xmlns="${XMLNS}">`, ...lines.map((line) => `    ${line}`), `</${root}>`, ''].join('\n');

/** A source that is written in a test: files by path, and the components they make up. */
export class Source {
  readonly files = new Map<string, Uint8Array>();
  readonly listed: ResolvedComponent[] = [];
  /** Paths that fail when they are read. */
  readonly broken = new Set<string>();

  file(path: string, content: string | Uint8Array): string {
    this.files.set(path, typeof content === 'string' ? Buffer.from(content, 'utf8') : content);
    return path;
  }

  object(name: string, ...lines: string[]): string {
    const path = this.file(`objects/${name}/${name}.object-meta.xml`, xml('CustomObject', ...lines));
    this.listed.push({ type: 'CustomObject', fullName: name, files: [path] });
    return path;
  }

  field(object: string, name: string, ...lines: string[]): string {
    return this.fieldFile(object, name, xml('CustomField', `<fullName>${name}</fullName>`, ...lines));
  }

  fieldFile(object: string, name: string, content: string | Uint8Array): string {
    const path = this.file(`objects/${object}/fields/${name}.field-meta.xml`, content);
    this.listed.push({ type: 'CustomField', fullName: `${object}.${name}`, files: [path] });
    return path;
  }

  rule(object: string, name: string, ...lines: string[]): string {
    const path = this.file(
      `objects/${object}/validationRules/${name}.validationRule-meta.xml`,
      xml('ValidationRule', `<fullName>${name}</fullName>`, ...lines),
    );
    this.listed.push({ type: 'ValidationRule', fullName: `${object}.${name}`, files: [path] });
    return path;
  }

  get tree(): SourceTree {
    return {
      files: [...this.files.keys()].sort(),
      read: (path) => {
        const content = this.files.get(path);
        if (content === undefined || this.broken.has(path)) throw new Error(`${path} cannot be read.`);
        return content;
      },
    };
  }

  analyse(): SourceAnalysis {
    return analyseSource(this.tree, this.listed);
  }
}

/** The value of a picklist that a reference says a formula compares its target with, or `null`. */
export const valueOf = (reference: Reference): string | null => {
  const value = reference.attrs?.['value'];
  return typeof value === 'string' ? value : null;
};

/** The references of an analysis as `line:column kind target [name] resolution via`, in the order of the files. */
export const told = (analysis: SourceAnalysis, from?: ComponentKey): string[] =>
  analysis.components
    .filter((one) => from === undefined || one.key === from)
    .flatMap((one) => one.references)
    .map(
      (one) =>
        `${String(one.location?.line)}:${String(one.location?.column)} ${one.kind} ${String(one.to)} [${one.toNameRaw}] ${one.resolution} ${viaOf(one)}`,
    );
