/**
 * A source that a test writes: files of objects, fields, validation rules and flows by path, and the components
 * they make up. The tests of the analysis use it for what the fixture project does not have.
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

  /**
   * A record of a custom metadata type, `type` without its suffix, with the value of each field as a text, as
   * Salesforce writes a value of a field of the type `Text`.
   */
  metadataRecord(type: string, name: string, values: Readonly<Record<string, string>>): string {
    const lines = [
      HEAD,
      `<CustomMetadata xmlns="${XMLNS}" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">`,
      `    <label>${name}</label>`,
      '    <protected>false</protected>',
      ...Object.entries(values).flatMap(([field, value]) => [
        '    <values>',
        `        <field>${field}</field>`,
        `        <value xsi:type="xsd:string">${value}</value>`,
        '    </values>',
      ]),
      '</CustomMetadata>',
      '',
    ];
    const path = this.file(`customMetadata/${type}.${name}.md-meta.xml`, lines.join('\n'));
    this.listed.push({ type: 'CustomMetadata', fullName: `${type}.${name}`, files: [path] });
    return path;
  }

  /** A field set of `object` that holds the fields `shown` and offers the fields `offered`. */
  fieldSet(object: string, name: string, shown: readonly string[], offered: readonly string[] = []): string {
    const field = (group: string, path: string): string[] => [
      `<${group}>`,
      `    <field>${path}</field>`,
      '    <isFieldManaged>false</isFieldManaged>',
      '    <isRequired>false</isRequired>',
      `</${group}>`,
    ];
    const path = this.file(
      `objects/${object}/fieldSets/${name}.fieldSet-meta.xml`,
      xml(
        'FieldSet',
        `<fullName>${name}</fullName>`,
        ...offered.flatMap((one) => field('availableFields', one)),
        '<description>A field set of a test.</description>',
        ...shown.flatMap((one) => field('displayedFields', one)),
        `<label>${name}</label>`,
      ),
    );
    this.listed.push({ type: 'FieldSet', fullName: `${object}.${name}`, files: [path] });
    return path;
  }

  flow(name: string, ...lines: string[]): string {
    const path = this.file(`flows/${name}.flow-meta.xml`, xml('Flow', ...lines));
    this.listed.push({ type: 'Flow', fullName: name, files: [path] });
    return path;
  }

  /**
   * A Lightning web component: its files by their paths in its folder, such as `name.js`, `name.html` or
   * `__tests__/name.test.js`, and its file of metadata.
   */
  bundle(name: string, files: Readonly<Record<string, string | Uint8Array>>): string {
    const folder = `lwc/${name}`;
    const meta = this.file(
      `${folder}/${name}.js-meta.xml`,
      xml('LightningComponentBundle', '<isExposed>false</isExposed>'),
    );
    const paths = Object.entries(files).map(([path, content]) => this.file(`${folder}/${path}`, content));
    this.listed.push({ type: 'LightningComponentBundle', fullName: name, files: [...paths, meta].sort() });
    return folder;
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

const META = (type: string): string =>
  `${HEAD}\n<${type} xmlns="${XMLNS}">\n    <apiVersion>65.0</apiVersion>\n    <status>Active</status>\n</${type}>\n`;

/** A source with classes and triggers, each a file of code and its file of metadata. */
export class ApexSource extends Source {
  apexClass(name: string, code: string | Uint8Array): string {
    const path = this.file(`classes/${name}.cls`, code);
    this.listed.push({
      type: 'ApexClass',
      fullName: name,
      files: [path, this.file(`${path}-meta.xml`, META('ApexClass'))],
    });
    return path;
  }

  apexTrigger(name: string, code: string): string {
    const path = this.file(`triggers/${name}.trigger`, code);
    this.listed.push({
      type: 'ApexTrigger',
      fullName: name,
      files: [path, this.file(`${path}-meta.xml`, META('ApexTrigger'))],
    });
    return path;
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
