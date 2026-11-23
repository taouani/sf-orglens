/**
 * Which flows of a snapshot of an org are asked for once more, by the number of their active version, and which
 * file of that retrieve is taken (`api/flow-versions.ts`, decision record 0060).
 */
import { describe, expect, it } from 'vitest';
import { activeVersionIn, flowsNotActive, stateOf, versionName } from '../src/api/flow-versions.ts';
import { Source, xml } from './helpers/written-source.ts';

const flow = (state: string | null): string =>
  xml('Flow', '<label>F</label>', ...(state === null ? [] : [`<status>${state}</status>`]));
const definition = (...lines: string[]): string => xml('FlowDefinition', ...lines);

describe('the flows whose active version is asked for', () => {
  it('asks for a flow that is not active and whose definition names an active version, whatever its state', () => {
    const source = new Source();
    source.file('flows/Drafted.flow-meta.xml', flow('Draft'));
    source.file(
      'flowDefinitions/Drafted.flowDefinition-meta.xml',
      definition('<activeVersionNumber>1</activeVersionNumber>'),
    );
    // An older version was activated again: the latest is obsolete. The rule goes by "not active".
    source.file('flows/Again.flow-meta.xml', flow('Obsolete'));
    source.file(
      'flowDefinitions/Again.flowDefinition-meta.xml',
      definition('<activeVersionNumber>12</activeVersionNumber>'),
    );
    source.file('flows/Broken.flow-meta.xml', flow('InvalidDraft'));
    source.file(
      'flowDefinitions/Broken.flowDefinition-meta.xml',
      definition('<activeVersionNumber> 3 </activeVersionNumber>'),
    );
    expect(flowsNotActive(source.tree)).toEqual({
      fetch: [
        { flow: 'Again', state: 'Obsolete', version: 12 },
        { flow: 'Broken', state: 'InvalidDraft', version: 3 },
        { flow: 'Drafted', state: 'Draft', version: 1 },
      ],
      unknown: [],
    });
  });

  it('leaves an active flow alone, and one whose definition names no active version', () => {
    const source = new Source();
    source.file('flows/Running.flow-meta.xml', flow('Active'));
    // A definition that names a number for an active flow is not read: there is nothing to ask for.
    source.file(
      'flowDefinitions/Running.flowDefinition-meta.xml',
      definition('<activeVersionNumber>4</activeVersionNumber>'),
    );
    source.file('flows/Never.flow-meta.xml', flow('Draft'));
    source.file('flowDefinitions/Never.flowDefinition-meta.xml', definition());
    source.file('flows/Zero.flow-meta.xml', flow('Draft'));
    source.file(
      'flowDefinitions/Zero.flowDefinition-meta.xml',
      definition('<activeVersionNumber>0</activeVersionNumber>'),
    );
    expect(flowsNotActive(source.tree)).toEqual({ fetch: [], unknown: [] });
  });

  it('says of a flow that is not active and has no definition, or one that cannot be read, that nothing is known', () => {
    const source = new Source();
    source.file('flows/Alone.flow-meta.xml', flow('Draft'));
    source.file('flows/Garbled.flow-meta.xml', flow('Draft'));
    source.file('flowDefinitions/Garbled.flowDefinition-meta.xml', '<FlowDefinition><activeVersionNumber>1');
    source.file('flows/Other.flow-meta.xml', flow('Draft'));
    source.file(
      'flowDefinitions/Other.flowDefinition-meta.xml',
      xml('Flow', '<activeVersionNumber>1</activeVersionNumber>'),
    );
    // Salesforce writes a number as digits without a leading zero. Another number is not guessed at.
    const odd = ['1.5', '01', '-1', '1e3', 'one', '1234567890'];
    for (const [at, number] of odd.entries()) {
      source.file(`flows/Odd${String(at)}.flow-meta.xml`, flow('Draft'));
      source.file(
        `flowDefinitions/Odd${String(at)}.flowDefinition-meta.xml`,
        definition(`<activeVersionNumber>${number}</activeVersionNumber>`),
      );
    }
    expect(flowsNotActive(source.tree)).toEqual({
      fetch: [],
      unknown: [
        { flow: 'Alone', state: 'Draft', reason: 'no-definition' },
        { flow: 'Garbled', state: 'Draft', reason: 'definition-unreadable' },
        ...odd.map((_, at) => ({ flow: `Odd${String(at)}`, state: 'Draft', reason: 'definition-unreadable' })),
        { flow: 'Other', state: 'Draft', reason: 'definition-unreadable' },
      ],
    });
  });

  it('leaves to the analysis a file of a flow whose state cannot be read, and reads only files of flows', () => {
    const source = new Source();
    source.file('flows/Stateless.flow-meta.xml', flow(null));
    source.file('flows/Cut.flow-meta.xml', '<Flow><status>Draft');
    source.file('flows/NoFlow.flow-meta.xml', xml('CustomObject', '<status>Draft</status>'));
    source.file('flows/deeper/Nested.flow-meta.xml', flow('Draft'));
    source.file('flows/Notes.txt', 'Draft');
    source.file('other/Thing.flow-meta.xml', flow('Draft'));
    expect(flowsNotActive(source.tree)).toEqual({ fetch: [], unknown: [] });
    expect(stateOf(Buffer.from(flow('Draft')))).toBe('Draft');
    expect(stateOf(Buffer.from(flow(' ')))).toBeNull();
  });
});

describe('the file of the active version', () => {
  const ACTIVE = Buffer.from(flow('Active'));

  it('is taken under the name with the number, or under the name of the flow, if it says that it is active', () => {
    expect(versionName('Invoice_Recalculate', 1)).toBe('Invoice_Recalculate-1');
    const older = new Source();
    older.file('flows/F-1.flow-meta.xml', ACTIVE);
    expect(activeVersionIn(older.tree, 'F', 1)).toEqual({ content: ACTIVE, latest: false });
    // The latest version comes back under the name of the flow, also when it is asked for by its number.
    const latest = new Source();
    latest.file('flows/F.flow-meta.xml', ACTIVE);
    expect(activeVersionIn(latest.tree, 'F', 1)).toEqual({ content: ACTIVE, latest: true });
    // Another number, or another flow, is not taken.
    const other = new Source();
    other.file('flows/F-2.flow-meta.xml', ACTIVE);
    other.file('flows/G-1.flow-meta.xml', ACTIVE);
    expect(activeVersionIn(other.tree, 'F', 1)).toEqual({ content: null, states: [] });
  });

  it('is not taken if it says that it is not active, and the states of what came back are given', () => {
    const source = new Source();
    source.file('flows/F-1.flow-meta.xml', flow('Obsolete'));
    source.file('flows/F.flow-meta.xml', '<Flow>');
    expect(activeVersionIn(source.tree, 'F', 1)).toEqual({ content: null, states: ['Obsolete', 'unknown'] });
  });
});
