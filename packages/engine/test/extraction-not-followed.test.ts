/**
 * What a path that is not followed leaves out, against the rule that says which answers its warning bears on
 * (decision record 0074). Each form of a name that walks a relationship is analysed twice: once where nothing says
 * which object the relationship leads to, and once where the lookup behind it names its object. Each reference the
 * second analysis has and the first lacks would bring its component into the answer about the target. The first
 * analysis must have a warning of that component which bears on that answer.
 */
import { describe, expect, it } from 'vitest';
import { warningsThatBear } from '../src/engines/warnings.ts';
import type { ComponentKey } from '../src/core/keys.ts';
import type { SourceAnalysis } from '../src/extraction/analyse.ts';
import { analyseSource } from '../src/extraction/analyse.ts';
import { resolveComponents } from '../src/sources/resolve.ts';
import type { AnalysisWarning } from '../src/store/snapshots.ts';
import { Source, xml } from './helpers/written-source.ts';

/** A form of a name, written into a source where it is `known` which object a relationship leads to, or not. */
interface Form {
  readonly name: string;
  readonly write: (source: Source, known: boolean) => void;
  /** The components that are written differently where it is known, whose references are not compared. */
  readonly varied?: readonly string[];
}

/** A flow on the records of `Box__c` with these elements. */
const flow = (source: Source, ...elements: string[]): void => {
  source.file(
    'flows/Ship.flow-meta.xml',
    xml(
      'Flow',
      '<status>Active</status>',
      '<start>',
      '    <object>Box__c</object>',
      '    <triggerType>RecordAfterSave</triggerType>',
      '</start>',
      ...elements,
    ),
  );
};
/** A decision of a flow with one condition. */
const decision = (left: string, operator: string, right: string): string[] => [
  '<decisions>',
  '    <name>Check</name>',
  '    <rules>',
  '        <name>Yes</name>',
  '        <conditionLogic>and</conditionLogic>',
  '        <conditions>',
  `            <leftValueReference>${left}</leftValueReference>`,
  `            <operator>${operator}</operator>`,
  `            <rightValue>${right}</rightValue>`,
  '        </conditions>',
  '    </rules>',
  '</decisions>',
];
/** An element of a flow that updates the record `record`, and sets its field `Weight__c`. */
const update = (record: string): string[] => [
  '<recordUpdates>',
  '    <name>Save</name>',
  `    <inputReference>${record}</inputReference>`,
  '    <inputAssignments>',
  '        <field>Weight__c</field>',
  '        <value><numberValue>1</numberValue></value>',
  '    </inputAssignments>',
  '</recordUpdates>',
];

const FORMS: readonly Form[] = [
  {
    name: 'a path in a formula',
    write: (source) => {
      source.field('Box__c', 'Heavy__c', '<formula>Parcel__r.Weight__c &gt; 30</formula>', '<type>Checkbox</type>');
    },
  },
  {
    name: 'a path in a flow',
    write: (source) => {
      flow(source, ...decision('$Record.Parcel__r.Weight__c', 'GreaterThan', '<numberValue>30</numberValue>'));
    },
  },
  {
    // The fields of the element are walked behind the record, and the record says where the walk stopped.
    name: 'the record an element of a flow updates, and the field it sets',
    write: (source) => {
      flow(source, ...update('$Record.Parcel__r'));
    },
  },
  {
    name: 'a record type a flow compares a record with',
    write: (source) => {
      flow(
        source,
        ...decision('$Record.Parcel__r.RecordType.DeveloperName', 'EqualTo', '<stringValue>Fragile</stringValue>'),
      );
    },
  },
  {
    name: 'a field of the parent a field update writes',
    write: (source) => {
      source.file(
        'workflows/Box__c.workflow-meta.xml',
        xml(
          'Workflow',
          '<fieldUpdates>',
          '    <fullName>Set_Weight</fullName>',
          '    <field>Weight__c</field>',
          '    <formula>1</formula>',
          '    <targetObject>Parcel__c</targetObject>',
          '</fieldUpdates>',
        ),
      );
    },
  },
  {
    // A variable that holds a record of no object it names: the record an element updates, and its field.
    name: 'a record a variable of a flow holds',
    write: (source, known) => {
      flow(
        source,
        ...update('Pack'),
        '<variables>',
        '    <name>Pack</name>',
        '    <dataType>SObject</dataType>',
        '    <isCollection>false</isCollection>',
        '    <isInput>false</isInput>',
        '    <isOutput>false</isOutput>',
        ...(known ? ['    <objectType>Parcel__c</objectType>'] : []),
        '</variables>',
      );
    },
    varied: ['Flow:ship#element:pack'],
  },
  {
    // A field named in a record of a custom metadata type, whose object is the value of another field. Where
    // nothing says which field that is, the field is not followed.
    name: 'a field a record of a custom metadata type names',
    write: (source, known) => {
      source.object('Map__mdt', '<label>Map</label>');
      source.field(
        'Map__mdt',
        'Object__c',
        '<referenceTo>EntityDefinition</referenceTo>',
        '<type>MetadataRelationship</type>',
      );
      source.field(
        'Map__mdt',
        'Field__c',
        ...(known
          ? ['<metadataRelationshipControllingField>Map__mdt.Object__c</metadataRelationshipControllingField>']
          : []),
        '<referenceTo>FieldDefinition</referenceTo>',
        '<type>MetadataRelationship</type>',
      );
      const value = (field: string, text: string): string[] => [
        '    <values>',
        `        <field>${field}</field>`,
        `        <value xsi:type="xsd:string">${text}</value>`,
        '    </values>',
      ];
      source.file(
        'customMetadata/Map.One.md-meta.xml',
        [
          '<?xml version="1.0" encoding="UTF-8"?>',
          '<CustomMetadata xmlns="http://soap.sforce.com/2006/04/metadata" xmlns:xsi="http://www.w3.org/2001/XMLSchema-instance" xmlns:xsd="http://www.w3.org/2001/XMLSchema">',
          '    <label>One</label>',
          '    <protected>false</protected>',
          ...value('Object__c', 'Parcel__c'),
          ...value('Field__c', 'Weight__c'),
          '</CustomMetadata>',
          '',
        ].join('\n'),
      );
    },
    varied: ['CustomField:map__mdt.field__c'],
  },
];

/**
 * A source with the object `Parcel__c`, its field `Weight__c` and its record type `Fragile`, and the object
 * `Box__c` with the lookup `Parcel__c`, which names its object only where that is `known`. The form is written
 * into it.
 */
async function analysed(form: Form, known: boolean): Promise<SourceAnalysis> {
  const source = new Source();
  source.object('Parcel__c', '<label>Parcel</label>');
  source.field('Parcel__c', 'Weight__c', '<type>Number</type>');
  source.file(
    'objects/Parcel__c/recordTypes/Fragile.recordType-meta.xml',
    xml('RecordType', '<fullName>Fragile</fullName>', '<active>true</active>', '<label>Fragile</label>'),
  );
  source.object('Box__c', '<label>Box</label>');
  source.field(
    'Box__c',
    'Parcel__c',
    ...(known ? ['<referenceTo>Parcel__c</referenceTo>'] : []),
    '<type>Lookup</type>',
  );
  form.write(source, known);
  return analyseSource(source.tree, (await resolveComponents(source.tree, [''])).components);
}

/** A reference of an analysis to a component, from the component that holds it. */
interface Pair {
  readonly from: ComponentKey;
  readonly to: ComponentKey;
}
/** The references of an analysis to a component, by `from -> to`. */
const pairsOf = (analysis: SourceAnalysis): Map<string, Pair> =>
  new Map(
    analysis.components.flatMap((component) =>
      component.references.flatMap((reference) =>
        reference.to === null
          ? []
          : [[`${component.key} -> ${reference.to}`, { from: component.key, to: reference.to }] as const],
      ),
    ),
  );

/** The warnings of an analysis as the store reads them back (`readAnalysisWarnings`). */
const warningsOf = (analysis: SourceAnalysis): AnalysisWarning[] =>
  analysis.issues
    .filter((issue) => issue.severity === 'warning')
    .map((issue) => {
      const names = issue.details?.['notFollowed'];
      const endsAt = issue.details?.['endsAt'];
      return {
        code: issue.code,
        componentKey: issue.componentKey,
        notFollowed:
          issue.code === 'PATH_NOT_FOLLOWED' && Array.isArray(names) && names.every((name) => typeof name === 'string')
            ? names
            : null,
        endsAt: issue.code === 'PATH_NOT_FOLLOWED' && (endsAt === 'field' || endsAt === 'object') ? endsAt : null,
      };
    });

describe('a path that is not followed', () => {
  it.each(FORMS)('has a warning for each answer a reference it misses would change: $name', async (form) => {
    const unknown = await analysed(form, false);
    const known = await analysed(form, true);
    const varied = new Set(['CustomField:box__c.parcel__c', ...(form.varied ?? [])]);
    const before = pairsOf(unknown);
    const missed = [...pairsOf(known)]
      .filter(([said, { from }]) => !before.has(said) && !varied.has(from))
      .map(([said, pair]) => ({ said, ...pair }));
    // Each form misses something where it is not known where the relationship leads, and says so.
    expect(missed).not.toEqual([]);
    const warnings = warningsOf(unknown);
    expect(warnings.map((warning) => warning.code)).toContain('PATH_NOT_FOLLOWED');
    const unanswered = missed.filter(({ from, to }) => {
      // The smallest answer that holds the target: what refers to it.
      const bearing = warningsThatBear(warnings, { start: [to], through: [], results: [] }, 'incoming');
      return !bearing.some((warning) => warning.componentKey === from);
    });
    expect(unanswered.map(({ said }) => said)).toEqual([]);
  });
});
