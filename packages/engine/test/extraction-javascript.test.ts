/**
 * The reader of the JavaScript of a Lightning component (decision record 0094): what a module imports, and how it
 * steps over what holds no import. That it reads every module of the public codebases without stopping is held by
 * `extraction-corpora.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { readModule } from '../src/extraction/javascript.ts';

/** The modules a text imports. The text between the two indexes of each is its name. */
const imported = (text: string): string[] =>
  readModule(text).imports.map((one) => {
    expect(text.slice(one.start, one.end)).toBe(one.specifier);
    return one.specifier;
  });

describe('the reader of JavaScript', () => {
  it('reads every form of an import and of an export from another module', () => {
    const text = [
      "import a from 'one';",
      'import { b, c as d } from "two";',
      "import * as e from 'three';",
      "import 'four';",
      "import f, { g } from 'five';",
      "import h, * as i from 'six';",
      "import { default as j, 'name with spaces' as k } from 'seven';",
      "export * from 'eight';",
      "export * as l from 'nine';",
      "export { m, default as n } from 'ten';",
      "export { o as default } from 'eleven'",
      "import p from 'twelve' with { type: 'json' };",
      '',
    ].join('\n');
    const reading = readModule(text);
    expect(imported(text)).toEqual([
      'one',
      'two',
      'three',
      'four',
      'five',
      'six',
      'seven',
      'eight',
      'nine',
      'ten',
      'eleven',
      'twelve',
    ]);
    expect(reading.imports.every((one) => !one.escaped)).toBe(true);
    expect(reading.unread).toEqual([]);
    expect(reading.stop).toBeNull();
  });

  it('reads no import where the module exports what it declares, or names import as a property', () => {
    const text = [
      'const a = 1, b = 2;',
      'export { a, b };',
      'export { a as c }',
      'export default class X extends LightningElement {',
      '    import = 1;',
      '    get export() { return this.import; }',
      "    method() { return { import: 'x', export: 'y' }; }",
      "    load() { return this.import('lazy'); }",
      '    url() { return import.meta.url; }',
      '}',
      'export const d = 4;',
      'export function e() {}',
      'export { f }',
    ].join('\n');
    const reading = readModule(text);
    expect(reading.imports).toEqual([]);
    expect(reading.unread).toEqual([]);
    expect(reading.stop).toBeNull();
  });

  it('steps over comments, strings, templates and regular expressions', () => {
    const text = [
      "#!/usr/bin/env node # it's",
      "// import a from 'comment';",
      "/* import 'block';",
      "   import 'block' */",
      `const s = "import 'string'", t = 'import "other"';`,
      "const u = `import 'template' ${ `import 'inner'` + { v: 1 }.v } import 'after'`;",
      "const r = /'/.test(s) ? /import 'regex'/g : null;",
      "const k = /[/']/u.test(s) && /\\/'/.test(s);",
      "const e = `\\` import 'escaped' ${'`'}`;",
      "const n = {} / 2; const m = '/';",
      "const w = 10 / 2 / 1; const x = '/';",
      "const g = (1) / 2; const h = '/';",
      "let y = 1; y++ / 2; import 'one';",
      "function z() { return /'/; } import 'two';",
      "const q = (1) / 2 + [3][0] / 4; import 'three';",
      'const o = { a: `${`${1}`}` };',
      "import 'four';",
      '',
    ].join('\n');
    const reading = readModule(text);
    expect(imported(text)).toEqual(['one', 'two', 'three', 'four']);
    expect(reading.unread).toEqual([]);
    expect(reading.stop).toBeNull();
  });

  it('says where a module is imported while the code runs, and where a clause is of no known form', () => {
    const text = [
      "const m = import('lazy');",
      "import a + b from 'one';",
      'export { c } from d;',
      "import { e, f from 'two';",
      '',
    ].join('\n');
    const reading = readModule(text);
    expect(reading.unread).toEqual([
      { what: 'dynamic', start: text.indexOf('import(') },
      { what: 'clause', start: text.indexOf('import a + b') },
      { what: 'clause', start: text.indexOf('export { c }') },
      { what: 'clause', start: text.indexOf('import { e, f') },
    ]);
    expect(reading.imports).toEqual([]);
    expect(reading.stop).toBeNull();
  });

  it('says that a clause at the end of the file has no module, and that a name of a module holds an escape', () => {
    expect(readModule("import { a } from 'one';\nimport b").unread).toEqual([{ what: 'clause', start: 25 }]);
    expect(readModule('export { a } from').unread).toEqual([{ what: 'clause', start: 0 }]);
    expect(readModule('export { a, b }').unread).toEqual([]);
    expect(readModule('export *').unread).toEqual([{ what: 'clause', start: 0 }]);
    expect(readModule('import { a }').unread).toEqual([{ what: 'clause', start: 0 }]);
    expect(readModule('export * ;').unread).toEqual([{ what: 'clause', start: 0 }]);
    // Without a semicolon, the clause ends at its braces, and what follows is read.
    expect(readModule("export { a }\nimport 'one'").imports.map((one) => one.specifier)).toEqual(['one']);
    expect(readModule("import { a }\nimport 'one'")).toMatchObject({
      imports: [{ specifier: 'one' }],
      unread: [{ what: 'clause', start: 0 }],
    });
    const escaped = readModule("import a from '\\x40salesforce/apex/A.b';\nimport 'c\\'d';");
    expect(escaped.imports.map((one) => one.escaped)).toEqual([true, true]);
    expect(escaped.imports[1]?.specifier).toBe("c'd");
    // The indexes hold the name as it is written.
    expect(escaped.imports.map((one) => one.end - one.start)).toEqual([23, 4]);
  });

  it('stops at what is not closed, says where and in what, and keeps what it read before', () => {
    const cases: [string, string, 'string' | 'comment' | 'template' | 'expression'][] = [
      ["import 'one';\nconst s = 'open\nimport 'two';", "'open", 'string'],
      ["import 'one';\n/* open\nimport 'two';", '/*', 'comment'],
      ["import 'one';\nconst t = `open\nimport 'two';", '`open', 'template'],
      ["import 'one';\nconst r = /open\nimport 'two';", '/open', 'expression'],
    ];
    for (const [text, at, what] of cases) {
      const reading = readModule(text);
      expect(reading.imports.map((one) => one.specifier)).toEqual(['one']);
      expect(reading.stop).toEqual({ at: text.indexOf(at), what });
    }
  });
});
