import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { EngineError } from '../src/core/errors.ts';
import {
  apexSignature,
  buildKey,
  canonicalType,
  foldName,
  isComponentKey,
  KeyRegistry,
  KNOWN_TYPES,
  parentKey,
  parseKey,
  SUB_KINDS,
  type ComponentKey,
  type KeyParts,
  type SubComponent,
} from '../src/core/keys.ts';

const method = (name: string, ...parameterTypes: string[]): SubComponent => ({
  kind: 'method',
  name: `${name}${apexSignature(parameterTypes)}`,
});

/**
 * The key examples of the plan, as inputs in their original spelling. The
 * expected keys are in the golden file, which was written by hand from the
 * plan and not produced by this code.
 */
const EXAMPLES: readonly (readonly [label: string, parts: KeyParts])[] = [
  ['custom object', { type: 'CustomObject', fullName: 'Invoice__c' }],
  ['standard field', { type: 'CustomField', fullName: 'Account.Industry' }],
  ['custom field in a managed namespace', { type: 'CustomField', fullName: 'Account.ns__Score__c' }],
  ['custom field on a managed object', { type: 'CustomField', fullName: 'ns__Invoice__c.ns__Amount__c' }],
  ['Apex class', { type: 'ApexClass', fullName: 'AccountService' }],
  ['Apex class in a managed namespace', { type: 'ApexClass', fullName: 'ns__BillingService' }],
  ['Apex method', { type: 'ApexClass', fullName: 'AccountService', subs: [method('run', 'Account')] }],
  [
    'Apex method overload',
    { type: 'ApexClass', fullName: 'AccountService', subs: [method('run', 'Account', 'Boolean')] },
  ],
  [
    'constructor',
    { type: 'ApexClass', fullName: 'AccountService', subs: [{ kind: 'ctor', name: apexSignature(['Id']) }] },
  ],
  ['property', { type: 'ApexClass', fullName: 'AccountService', subs: [{ kind: 'prop', name: 'isActive' }] }],
  ['inner class', { type: 'ApexClass', fullName: 'AccountService', subs: [{ kind: 'inner', name: 'Helper' }] }],
  [
    'method of an inner class',
    { type: 'ApexClass', fullName: 'AccountService', subs: [{ kind: 'inner', name: 'Helper' }, method('apply')] },
  ],
  ['trigger', { type: 'ApexTrigger', fullName: 'AccountTrigger' }],
  ['flow', { type: 'Flow', fullName: 'My_Flow' }],
  ['flow element', { type: 'Flow', fullName: 'My_Flow', subs: [{ kind: 'element', name: 'Decision_1' }] }],
  ['validation rule', { type: 'ValidationRule', fullName: 'Account.Region_Required' }],
  ['record type', { type: 'RecordType', fullName: 'Account.Partner' }],
  ['custom metadata type', { type: 'CustomObject', fullName: 'Settings__mdt' }],
  ['custom metadata record', { type: 'CustomMetadata', fullName: 'Settings.Default' }],
  ['permission set', { type: 'PermissionSet', fullName: 'Sales_Ops' }],
  ['profile', { type: 'Profile', fullName: 'Admin' }],
  ['profile with an encoded name', { type: 'Profile', fullName: 'Custom%3A Marketing Profile' }],
  ['Lightning web component', { type: 'LightningComponentBundle', fullName: 'myCmp' }],
  [
    'file of a Lightning web component',
    { type: 'LightningComponentBundle', fullName: 'myCmp', subs: [{ kind: 'file', name: 'myCmp.js' }] },
  ],
  ['named credential', { type: 'NamedCredential', fullName: 'ERP' }],
];

const expectInvalid = (run: () => unknown): void => {
  let thrown: unknown;
  try {
    run();
  } catch (error) {
    thrown = error;
  }
  expect(thrown).toBeInstanceOf(EngineError);
  expect((thrown as EngineError).code).toBe('KEY_INVALID');
};

describe('buildKey', () => {
  it('builds the key examples of the plan', async () => {
    const built = EXAMPLES.map(([label, parts]) => {
      const key = buildKey(parts);
      return { label, key, parent: parentKey(key) ?? null };
    });
    await expect(`${JSON.stringify(built, null, 2)}\n`).toMatchFileSnapshot('./golden/key-examples.json');
  });

  it('gives every example a key that parses back', () => {
    for (const [, parts] of EXAMPLES) {
      const key = buildKey(parts);
      expect(isComponentKey(key)).toBe(true);
      expect(buildKey({ type: parseKey(key).type, fullName: parseKey(key).name, subs: parseKey(key).subs })).toBe(key);
    }
  });

  it('gives all examples different keys', () => {
    const keys = EXAMPLES.map(([, parts]) => buildKey(parts));
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('never puts an org, a source or a snapshot in a key', () => {
    // The parts a key is built from have no place for them, and the key holds nothing but those parts.
    const key = buildKey({ type: 'CustomField', fullName: 'Account.Industry' });
    expect(key).toBe('CustomField:account.industry');
  });

  it('folds case, so that Apex text in any spelling resolves to the same key', () => {
    const expected = buildKey({ type: 'CustomField', fullName: 'Account.Region__c' });
    expect(buildKey({ type: 'CustomField', fullName: 'ACCOUNT.region__C' })).toBe(expected);
    expect(buildKey({ type: 'customfield', fullName: 'account.REGION__c' })).toBe(expected);
  });

  it('folds independently of the Unicode form', () => {
    // "é" as one code point and as "e" plus a combining accent are the same name.
    expect(buildKey({ type: 'Flow', fullName: 'Café' })).toBe(buildKey({ type: 'Flow', fullName: 'Café' }));
    expect(buildKey({ type: 'Flow', fullName: 'Café' })).toBe('Flow:café');
    // Lower-casing can leave a pair that composes: "J" plus caron becomes one code point.
    expect(foldName('J̌')).toBe('ǰ');
    // Compatibility forms are different names and stay different: no NFKC.
    expect(foldName('ﬁx')).toBe('ﬁx');
    expect(foldName('①')).toBe('①');
  });

  it('folds a letter the same way wherever it stands in a name', () => {
    // Lower-casing writes a Greek capital sigma as a final sigma at the end of a word. Keys use one sigma.
    expect(foldName('ΑΣ')).toBe('ασ');
    expect(foldName('ΑΣ.F')).toBe('ασ.f');
    expect(foldName('ας')).toBe('ασ');
    const field = buildKey({ type: 'CustomField', fullName: 'ΑΣ.F' });
    expect(parentKey(field)).toBe(buildKey({ type: 'CustomObject', fullName: 'ΑΣ' }));
  });

  it('keeps overloads apart and treats an array and a list as the same type', () => {
    const run = (...types: string[]): ComponentKey =>
      buildKey({ type: 'ApexClass', fullName: 'AccountService', subs: [method('run', ...types)] });
    expect(run('Account')).not.toBe(run('Account', 'Boolean'));
    expect(run()).toBe('ApexClass:accountservice#method:run()');
    expect(run('String[]')).toBe(run('List<String>'));
    expect(run('Map<Id, List<Account>>')).toBe('ApexClass:accountservice#method:run(map<id,list<account>>)');
  });

  it('accepts a method or a constructor only with its signature in canonical form', () => {
    const sub = (kind: 'method' | 'ctor', name: string): KeyParts => ({
      type: 'ApexClass',
      fullName: 'A',
      subs: [{ kind, name }],
    });
    expect(buildKey(sub('method', 'Run(Account,list<String>)'))).toBe('ApexClass:a#method:run(account,list<string>)');
    expect(buildKey(sub('ctor', '(Id)'))).toBe('ApexClass:a#ctor:(id)');
    for (const name of [
      'run',
      'run(',
      'run)',
      'run(String[])',
      'run(a, b)',
      'run(a,)',
      'run(,a)',
      'run()x',
      'r un()',
    ]) {
      expectInvalid(() => buildKey(sub('method', name)));
    }
    for (const name of ['a', 'a()', '(String[])', '(a, b)', '(a,,b)']) {
      expectInvalid(() => buildKey(sub('ctor', name)));
    }
    // The other kinds carry no signature and are not checked for one.
    expect(buildKey({ type: 'ApexClass', fullName: 'A', subs: [{ kind: 'prop', name: 'run' }] })).toBe(
      'ApexClass:a#prop:run',
    );
  });

  it('writes a namespace as part of the name', () => {
    expect(buildKey({ type: 'ApexClass', fullName: 'ns__BillingService' })).not.toBe(
      buildKey({ type: 'ApexClass', fullName: 'BillingService' }),
    );
  });

  it('escapes "#" in a name and keeps the percent-encoding Salesforce delivers', () => {
    expect(buildKey({ type: 'Report', fullName: 'Sales/Top #1' })).toBe('Report:sales/top %231');
    expect(buildKey({ type: 'Layout', fullName: 'Account-Sales %28EMEA%29' })).toBe('Layout:account-sales %28emea%29');
    expect(buildKey({ type: 'Profile', fullName: 'a:b' })).toBe('Profile:a:b');
  });

  it('escapes "%", "#" and "/" in the name of a sub-component and decodes them again', () => {
    const key = buildKey({
      type: 'LightningComponentBundle',
      fullName: 'myCmp',
      subs: [{ kind: 'file', name: 'a/b#c%d.js' }],
    });
    expect(key).toBe('LightningComponentBundle:mycmp#file:a%2Fb%23c%25d.js');
    expect(parseKey(key).subs).toEqual([{ kind: 'file', name: 'a/b#c%d.js' }]);
  });

  it('accepts a metadata type it does not know, in the spelling of the Metadata API', () => {
    expect(buildKey({ type: 'CustomLabel', fullName: 'Greeting' })).toBe('CustomLabel:greeting');
  });

  it('rejects what cannot be a key', () => {
    expectInvalid(() => buildKey({ type: 'customLabel', fullName: 'Greeting' }));
    expectInvalid(() => buildKey({ type: 'Custom Label', fullName: 'Greeting' }));
    expectInvalid(() => buildKey({ type: '', fullName: 'Greeting' }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: '' }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: 'a\tb' }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: 'a\nb' }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: 'a\u2028b' }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: 'a\uD800b' }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: 'F', subs: [{ kind: 'element', name: '\uDC00' }] }));
    expectInvalid(() => buildKey({ type: 'My_Type', fullName: 'Greeting' }));
    expectInvalid(() => buildKey({ type: '9Type', fullName: 'Greeting' }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: 'F', subs: [{ kind: 'element', name: '' }] }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: 'F', subs: [{ kind: 'element', name: 'a\u0000' }] }));
    expectInvalid(() => buildKey({ type: 'Flow', fullName: 'F', subs: [{ kind: 'step' as 'element', name: 'a' }] }));
  });

  it('reports the key it could not build, and nothing else, in the error details', () => {
    try {
      buildKey({ type: 'Flow', fullName: '' });
      expect.unreachable();
    } catch (error) {
      expect((error as EngineError).toJSON()).toEqual({
        code: 'KEY_INVALID',
        message: 'The name of a component key must not be empty.',
        details: { key: 'Flow:' },
      });
    }
  });
});

describe('canonicalType', () => {
  it('writes every known type in registry spelling, whatever the input case', () => {
    for (const type of KNOWN_TYPES) {
      expect(canonicalType(type.toUpperCase())).toBe(type);
      expect(canonicalType(type.toLowerCase())).toBe(type);
    }
  });

  it('compares only ASCII letters without case', () => {
    // The Kelvin sign lower-cases to "k". It is not a letter of a type name.
    expectInvalid(() => canonicalType('Wor\u212AflowRule'));
    expectInvalid(() => canonicalType('\u212A'));
  });

  it('keeps a type it does not know exactly as given', () => {
    expect(canonicalType('CustomLabel')).toBe('CustomLabel');
    expect(canonicalType('CUSTOMLABEL')).toBe('CUSTOMLABEL');
    expectInvalid(() => canonicalType('customLabel'));
    expectInvalid(() => canonicalType('Custom_Label'));
  });
});

describe('parseKey', () => {
  it('returns the parts of a key', () => {
    expect(parseKey('ApexClass:accountservice#inner:helper/method:apply()')).toEqual({
      type: 'ApexClass',
      name: 'accountservice',
      subs: [
        { kind: 'inner', name: 'helper' },
        { kind: 'method', name: 'apply()' },
      ],
    });
    expect(parseKey('CustomField:account.industry')).toEqual({
      type: 'CustomField',
      name: 'account.industry',
      subs: [],
    });
  });

  it('rejects a key that is not in canonical form', () => {
    const notCanonical = [
      '',
      'accountservice',
      ':accountservice',
      'ApexClass:',
      'apexclass:accountservice',
      'ApexClass:AccountService',
      'ApexClass:accountservice#',
      'ApexClass:accountservice#method',
      'ApexClass:accountservice#method:',
      'ApexClass:accountservice#method:Run()',
      'ApexClass:accountservice#step:run()',
      'ApexClass:accountservice#method:run()/',
      'ApexClass:accountservice#file:a%2fb',
      'ApexClass:accountservice#file:a%b',
      'ApexClass:accountservice#file:a#b',
      'ApexClass:account\tservice',
      'ApexClass:account\uD800service',
      'ApexClass:accountservice#method:run',
      'ApexClass:accountservice#method:run(string[])',
      'ApexClass:accountservice#method:run(string, id)',
      'ApexClass:accountservice#method:(id)',
      'ApexClass:accountservice#ctor:accountservice',
      'ApexClass:accountservice#ctor:accountservice(id)',
      'ApexClass:\u03B1\u03C2',
    ];
    for (const text of notCanonical) {
      expect(isComponentKey(text), text).toBe(false);
      expectInvalid(() => parseKey(text));
    }
  });
});

describe('parentKey', () => {
  const parentOf = (parts: KeyParts): string | undefined => parentKey(buildKey(parts));

  it('walks up the path of sub-components one step at a time', () => {
    const inner: SubComponent = { kind: 'inner', name: 'Helper' };
    expect(parentOf({ type: 'ApexClass', fullName: 'A', subs: [inner, method('apply')] })).toBe(
      'ApexClass:a#inner:helper',
    );
    expect(parentOf({ type: 'ApexClass', fullName: 'A', subs: [inner] })).toBe('ApexClass:a');
    expect(parentOf({ type: 'ApexClass', fullName: 'A' })).toBeUndefined();
  });

  it('places the children of an object under the object', () => {
    for (const type of ['CustomField', 'ValidationRule', 'RecordType', 'FieldSet', 'ListView']) {
      expect(parentOf({ type, fullName: 'ns__Invoice__c.Thing' })).toBe('CustomObject:ns__invoice__c');
    }
  });

  it('places a custom metadata record under its type', () => {
    expect(parentOf({ type: 'CustomMetadata', fullName: 'Settings.Default' })).toBe('CustomObject:settings__mdt');
    expect(parentOf({ type: 'CustomMetadata', fullName: 'ns__Settings.Default' })).toBe(
      'CustomObject:ns__settings__mdt',
    );
  });

  it('gives no parent to a top-level component, even when its name contains a dot', () => {
    expect(parentOf({ type: 'CustomObject', fullName: 'Account' })).toBeUndefined();
    expect(parentOf({ type: 'Profile', fullName: 'Sales v1.2' })).toBeUndefined();
    expect(parentOf({ type: 'CustomField', fullName: '.Odd' })).toBeUndefined();
    expect(parentOf({ type: 'CustomField', fullName: 'Account.' })).toBeUndefined();
    // A workflow rule is named after its object, and it belongs to the workflow file of that object.
    expect(parentOf({ type: 'WorkflowRule', fullName: 'Account.Notify owner' })).toBeUndefined();
  });

  it('ends the parent at the first dot', () => {
    expect(parentOf({ type: 'ListView', fullName: 'Account.Open v1.2' })).toBe('CustomObject:account');
    expect(parentOf({ type: 'CustomMetadata', fullName: 'Settings.Default.v2' })).toBe('CustomObject:settings__mdt');
  });

  it('does not write the suffix of a custom metadata type twice', () => {
    expect(parentOf({ type: 'CustomMetadata', fullName: 'Settings__mdt.Default' })).toBe('CustomObject:settings__mdt');
  });
});

describe('apexSignature', () => {
  it('folds case, removes whitespace and rewrites arrays as lists', () => {
    expect(apexSignature([])).toBe('()');
    expect(apexSignature(['Account', 'String[]'])).toBe('(account,list<string>)');
    expect(apexSignature(['Map < String , Account[] >'])).toBe('(map<string,list<account>>)');
    expect(apexSignature(['Integer[][]'])).toBe('(list<list<integer>>)');
    expect(apexSignature(['Map<Id, List<Account>>[]'])).toBe('(list<map<id,list<account>>>)');
    expect(apexSignature(['ns.Outer.Inner[]', 'Set<Id>'])).toBe('(list<ns.outer.inner>,set<id>)');
    // Text that is not a type must not hang or throw.
    expect(apexSignature(['>[]', '[][]', '<[]'])).toBe('(list<>>,list<list<>>,<list<>)');
  });

  it('rejects what cannot be a parameter type', () => {
    expectInvalid(() => apexSignature(['']));
    expectInvalid(() => apexSignature(['Account', '  ']));
    expectInvalid(() => apexSignature(['run(String)']));
  });
});

describe('KeyRegistry', () => {
  it('reports two components that fold to the same key and keeps the first', () => {
    const registry = new KeyRegistry();
    const upper = buildKey({ type: 'ApexClass', fullName: 'Foo' });
    const lower = buildKey({ type: 'ApexClass', fullName: 'foo' });
    expect(upper).toBe(lower);

    expect(registry.register({ key: upper, displayName: 'Foo' })).toBeUndefined();
    const collision = registry.register({ key: lower, displayName: 'foo' });

    expect(collision).toEqual({
      code: 'KEY_COLLISION',
      severity: 'error',
      key: 'ApexClass:foo',
      kept: 'Foo',
      dropped: 'foo',
      message: '"foo" and "Foo" have the same key ApexClass:foo. The first one is kept.',
    });
    expect(registry.collisions).toEqual([collision]);
    expect(registry.size).toBe(1);
    expect(registry.displayName(upper)).toBe('Foo');
  });

  it('names the files in a collision, so that two names that look the same can be told apart', () => {
    const registry = new KeyRegistry();
    const composed = buildKey({ type: 'Flow', fullName: 'Caf\u00E9' });
    const decomposed = buildKey({ type: 'Flow', fullName: 'Cafe\u0301' });
    registry.register({ key: composed, displayName: 'Caf\u00E9', file: 'flows/a.flow-meta.xml' });
    const collision = registry.register({ key: decomposed, displayName: 'Cafe\u0301', file: 'flows/b.flow-meta.xml' });
    expect(collision?.message).toBe(
      '"Cafe\u0301" (flows/b.flow-meta.xml) and "Caf\u00E9" (flows/a.flow-meta.xml) have the same key Flow:caf\u00E9. The first one is kept.',
    );
  });

  it('reports a collision for every further component with a taken key', () => {
    const registry = new KeyRegistry();
    const key = buildKey({ type: 'ApexClass', fullName: 'Foo' });
    registry.register({ key, displayName: '' });
    expect(registry.register({ key, displayName: 'foo' })?.kept).toBe('');
    expect(registry.register({ key, displayName: 'FOO' })?.kept).toBe('');
    expect(registry.collisions).toHaveLength(2);
  });

  it('keeps different components apart', () => {
    const registry = new KeyRegistry();
    const first = buildKey({ type: 'ApexClass', fullName: 'Foo' });
    const second = buildKey({ type: 'ApexTrigger', fullName: 'Foo' });
    registry.register({ key: first, displayName: 'Foo' });
    registry.register({ key: second, displayName: 'Foo' });
    expect(registry.collisions).toEqual([]);
    expect(registry.size).toBe(2);
    expect(registry.has(first)).toBe(true);
    expect(registry.has(buildKey({ type: 'Flow', fullName: 'Foo' }))).toBe(false);
    expect(registry.displayName(buildKey({ type: 'Flow', fullName: 'Foo' }))).toBeUndefined();
  });
});

describe('properties of keys', () => {
  const controlCharacters = /[\p{Cc}\p{Zl}\p{Zp}]/u;
  /** Any text a name can be: letters of every script, plus the characters the grammar gives a meaning to. */
  const nameText = fc
    .array(
      fc.oneof(
        fc.string({ unit: 'grapheme', maxLength: 6 }),
        fc.constantFrom('#', '/', '%', ':', '.', '%23', '%2F', '%2f', '%25', '__', 'İ', 'Σ', 'ß', 'ǅ', ' ', 'J̌'),
      ),
      { minLength: 1, maxLength: 6 },
    )
    .map((pieces) => pieces.join(''))
    .filter((text) => text !== '' && text.isWellFormed() && !controlCharacters.test(text));
  const parameterTypes = fc.array(
    fc.constantFrom('Account', 'String[]', 'Map<Id, Account>', 'ns.Outer.Inner', 'List<List<Id>>'),
    { maxLength: 3 },
  );
  const unsignedKinds = SUB_KINDS.filter((kind) => kind !== 'method' && kind !== 'ctor');
  /** The name of a method: any name text without whitespace and brackets. */
  const methodName = nameText.filter((text) => !/[()\s]/.test(foldName(text)));
  const subOf = (name: fc.Arbitrary<string>, method: fc.Arbitrary<string>): fc.Arbitrary<SubComponent> =>
    fc.oneof(
      fc.record({ kind: fc.constantFrom(...unsignedKinds), name }),
      fc
        .record({ kind: fc.constant('method' as const), name: fc.tuple(method, parameterTypes) })
        .map(({ kind, name: [text, types] }): SubComponent => ({ kind, name: `${text}${apexSignature(types)}` })),
      parameterTypes.map((types): SubComponent => ({ kind: 'ctor', name: apexSignature(types) })),
    );
  const subComponent = subOf(nameText, methodName);
  const keyParts = fc.record({
    type: fc.constantFrom(...KNOWN_TYPES, 'CustomLabel', 'apexclass', 'FLOW'),
    fullName: nameText,
    subs: fc.array(subComponent, { maxLength: 3 }),
  });
  /** Names as Salesforce API names are: ASCII. For these, upper case and lower case are the same name. */
  const asciiName = fc.stringMatching(/^[A-Za-z][A-Za-z0-9_.]{0,11}$/);
  const asciiSub = subOf(
    asciiName,
    asciiName.filter((text) => !text.includes('.')),
  );
  const upper = (subs: readonly SubComponent[]): SubComponent[] =>
    subs.map((sub) => ({ kind: sub.kind, name: sub.name.toUpperCase() }));

  it('folding is idempotent', () => {
    fc.assert(
      fc.property(nameText, (text) => {
        expect(foldName(foldName(text))).toBe(foldName(text));
      }),
    );
  });

  it('every key that is built parses, and its parts rebuild the same key', () => {
    fc.assert(
      fc.property(keyParts, (parts) => {
        const key = buildKey(parts);
        const parsed = parseKey(key);
        expect(parsed.type).toBe(canonicalType(parts.type));
        expect(parsed.subs).toEqual(parts.subs.map((sub) => ({ kind: sub.kind, name: foldName(sub.name) })));
        expect(buildKey({ type: parsed.type, fullName: parsed.name, subs: parsed.subs })).toBe(key);
        expect(Buffer.from(key, 'utf8').toString('utf8')).toBe(key);
      }),
    );
  });

  it('a key does not depend on the case of an ASCII name', () => {
    // This holds for ASCII only. For other scripts upper case is not the reverse of lower case: "ß" becomes "SS".
    fc.assert(
      fc.property(asciiName, fc.array(asciiSub, { maxLength: 3 }), (fullName, subs) => {
        const key = buildKey({ type: 'ApexClass', fullName, subs });
        expect(buildKey({ type: 'APEXCLASS', fullName: fullName.toUpperCase(), subs: upper(subs) })).toBe(key);
        expect(buildKey({ type: 'apexclass', fullName: fullName.toLowerCase(), subs })).toBe(key);
      }),
    );
  });

  it('two paths of sub-components give the same key exactly when they fold to the same path', () => {
    const paths = fc.array(asciiSub, { maxLength: 3 });
    // Half of the pairs are the same path in another case, so that both outcomes are tried.
    const pair = fc.oneof(
      fc.tuple(paths, paths),
      paths.map((path): [SubComponent[], SubComponent[]] => [path, upper(path)]),
    );
    fc.assert(
      fc.property(pair, ([a, b]) => {
        const fold = (subs: readonly SubComponent[]): string =>
          JSON.stringify(subs.map((sub) => [sub.kind, foldName(sub.name)]));
        const keyA = buildKey({ type: 'ApexClass', fullName: 'A', subs: a });
        const keyB = buildKey({ type: 'ApexClass', fullName: 'A', subs: b });
        expect(keyA === keyB).toBe(fold(a) === fold(b));
      }),
    );
  });

  it('the parent of a sub-component is the key without its last step', () => {
    fc.assert(
      fc.property(keyParts, subComponent, (parts, last) => {
        const child = buildKey({ ...parts, subs: [...parts.subs, last] });
        expect(parentKey(child)).toBe(buildKey(parts));
      }),
    );
  });

  const expectParsesOrIsInvalid = (text: string): boolean => {
    try {
      const parsed = parseKey(text);
      expect(buildKey({ type: parsed.type, fullName: parsed.name, subs: parsed.subs })).toBe(text);
      return true;
    } catch (error) {
      expect(error).toBeInstanceOf(EngineError);
      expect((error as EngineError).code).toBe('KEY_INVALID');
      return false;
    }
  };

  it('parseKey never throws anything but KEY_INVALID, whatever the text', () => {
    fc.assert(
      fc.property(fc.string({ unit: 'binary' }), (text) => {
        expectParsesOrIsInvalid(text);
      }),
    );
  });

  it('a key with one character changed either parses to itself or is rejected', () => {
    // Random text almost never parses. A valid key with one change does about one time in three.
    const change = fc.record({
      at: fc.nat(),
      remove: fc.boolean(),
      insert: fc.constantFrom('', '#', '/', '%', ':', '.', '(', ')', ',', ' ', 'a', 'A', '2', '\u0000', '\uD800'),
    });
    let parsed = 0;
    fc.assert(
      fc.property(keyParts, change, (parts, { at, remove, insert }) => {
        const key = buildKey(parts);
        const position = at % (key.length + 1);
        const changed = `${key.slice(0, position)}${insert}${key.slice(position + (remove ? 1 : 0))}`;
        if (expectParsesOrIsInvalid(changed)) parsed += 1;
      }),
      { numRuns: 500 },
    );
    expect(parsed).toBeGreaterThan(20);
  });
});
