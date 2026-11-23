/**
 * What the file of a flow says: the flow, each of its elements and resources, and the names in them.
 *
 * A flow writes a name in three ways. As the value of an element beside the object it is a field of
 * (`<field>Status__c</field>` beside `<object>Invoice__c</object>`). As a reference to a resource of the flow
 * with a path of fields (`Get_Invoice.Account__r.Name`), in an element such as `elementReference`. And as a
 * merge field in a text or a formula (`{!$Record.Amount__c}`). The second and the third need to know what a
 * resource holds: `resourcesOf` says it, from the file alone.
 *
 * Only the reading is done here, as in `objects.ts`. The names are resolved against the model of all objects
 * when every file was read (`raw-references.ts`). Decision record 0061 has the rules and what is not read.
 */
import type { JsonValue } from '../core/errors.ts';
import { cut } from './analysed.ts';
import type { MergeStart } from './formula-names.ts';
import {
  readFormulaOfMergeFields,
  readMergeFields,
  readResourceName,
  type FormulaReading,
  type MergeFieldsReading,
  type StartOf,
} from './names-in-text.ts';
import type { ElementReading } from './objects.ts';
import { LONGEST_TEXT_SHOWN, type RawReference, type RecordOp, type Unread, type Via } from './raw-references.ts';
import { placesIn, textOf, valueOf, type NameAt, type PlaceOf, type Value } from './values.ts';
import { childOf, childrenOf, type XmlDocument, type XmlElement } from './xml.ts';

/** The name of the element that stands for the start of a flow. No element of a flow can have a name like it. */
const START = 'flow-start';

/** One element or resource of a flow. */
interface FlowElement {
  /** The name as the file spells it. The start has the name `START`. */
  readonly name: string;
  /** The element of the file that defines it. */
  readonly element: XmlElement;
  readonly reading: ElementReading;
}

export interface FlowReading {
  /** What the flow itself says, outside its elements. */
  readonly flow: ElementReading;
  /** The elements and resources, in the order of the file. */
  readonly elements: readonly FlowElement[];
  /** Elements of a kind that has elements with a name, and that have none. Nothing is read of them. */
  readonly nameless: readonly { readonly group: string; readonly line: number; readonly column: number }[];
}

/**
 * The kinds of element and resource, by the name of the element of the file that holds one. The names are those
 * of the type of a flow in `@salesforce/types` 1.9.0, which the Salesforce library brings, and a test holds them
 * against it. The six flows of the fixture project, which a test org accepted, hold some of them.
 */
export const KINDS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    actionCalls: 'action',
    apexPluginCalls: 'apex-plugin',
    assignments: 'assignment',
    choices: 'choice',
    collectionFilterCriteria: 'collection-filter',
    collectionProcessors: 'collection-processor',
    constants: 'constant',
    customErrors: 'custom-error',
    dataLookups: 'data-lookup',
    decisions: 'decision',
    dynamicChoiceSets: 'choice-set',
    ends: 'end',
    exitRules: 'exit-rule',
    experiments: 'experiment',
    formulas: 'formula',
    groups: 'group',
    loops: 'loop',
    orchestratedStages: 'orchestrated-stage',
    recordCreates: 'create',
    recordDeletes: 'delete',
    recordLookups: 'lookup',
    recordRollbacks: 'rollback',
    recordUpdates: 'update',
    screens: 'screen',
    stages: 'stage',
    start: 'start',
    steps: 'step',
    subflows: 'subflow',
    textTemplates: 'text-template',
    transforms: 'transform',
    variables: 'variable',
    waits: 'wait',
  }),
);

/** What a record element does to the records of the object it names. */
const OPS: ReadonlyMap<string, RecordOp> = new Map([
  ['recordLookups', 'lookup'],
  ['dynamicChoiceSets', 'lookup'],
  ['recordCreates', 'create'],
  ['recordUpdates', 'update'],
  ['recordDeletes', 'delete'],
]);
/** What a record element does to the records of the object it names. A create that can also update is an upsert. */
const opOf = (group: string, element: XmlElement): RecordOp =>
  group === 'recordCreates' && textOf(childOf(element, 'doesUpsert')) === 'true'
    ? 'upsert'
    : (OPS.get(group) ?? 'lookup');

/** Groups of the file that hold values of the builder and no element. Nothing in them is a name. */
export const NO_ELEMENTS: ReadonlySet<string> = new Set(['processMetadataValues', 'customProperties']);

/**
 * The groups inside an element that hold names of fields of the object of the element. A group that names an
 * object of its own is read in `fieldsIn`. In any other group, a name of a field stands where no object is named.
 */
const SAME_OBJECT: ReadonlySet<string> = new Set([
  'filters',
  'inputAssignments',
  'outputAssignments',
  'sortOptions',
  'transformValues',
  'transformValueActions',
]);

/**
 * What an action starts, by the type of the action: an Apex class, a flow or an email alert. A step of an
 * orchestration runs a flow, and so does the condition of a step that an evaluation flow decides. Those three
 * types are written as the author knows them, and no file here holds one.
 */
export const STARTS: ReadonlyMap<string, { type: string; kind: 'calls' | 'references'; tier?: 'probable' }> = new Map([
  ['apex', { type: 'ApexClass', kind: 'calls' }],
  ['flow', { type: 'Flow', kind: 'calls' }],
  ['emailAlert', { type: 'WorkflowAlert', kind: 'references' }],
  ['stepInteractive', { type: 'Flow', kind: 'calls', tier: 'probable' }],
  ['stepBackground', { type: 'Flow', kind: 'calls', tier: 'probable' }],
  ['evaluationFlow', { type: 'Flow', kind: 'calls', tier: 'probable' }],
]);
/** The beginnings of the names of the elements that hold an action and its type, as `actionName` and `actionType`. */
const ACTIONS = ['action', 'entryAction', 'exitAction', 'autoApprovalAction'] as const;

/** The elements that hold a formula of a flow. */
const FORMULAS: ReadonlySet<string> = new Set(['expression', 'filterFormula', 'formulaExpression', 'formula']);

/** The elements that hold a text with merge fields. A merge field in any other element is read as less certain. */
const TEXTS: ReadonlySet<string> = new Set([
  'stringValue',
  'fieldText',
  'errorMessage',
  'text',
  'helpText',
  'pausedText',
  'choiceText',
  'promptText',
  'interviewLabel',
]);

/** Elements that hold the name of a resource whose field, if it names one, is read. */
const READS: ReadonlySet<string> = new Set(['elementReference', 'leftValueReference', 'collectionReference']);
/** Elements that hold the name of a resource whose field, if it names one, is written. */
const WRITES: ReadonlySet<string> = new Set([
  'assignToReference',
  'outputReference',
  'assignNextValueToReference',
  'assignRecordIdToReference',
]);
/** Elements that hold the name of another element of the flow, never a field. */
const ELEMENT_NAMES: ReadonlySet<string> = new Set([
  'targetReference',
  'choiceReferences',
  'defaultSelectedChoiceReference',
  'fieldReference',
  'startElementReference',
]);
/**
 * Elements whose names end as those of the elements that hold a resource, and that hold none: the name of an
 * item of the setup, such as a record type, of the type `setupReferenceType` names. They are not read.
 */
const NO_RESOURCES: ReadonlySet<string> = new Set(['setupReference']);
/** The operators of an assignment that write a value and do not read the one that was there. */
const ONLY_WRITES: ReadonlySet<string> = new Set(['Assign', 'AssignCount']);

/** The kinds of trigger of a start that a record of its object sets off: a change of records, or an event. */
export const ON_RECORDS: ReadonlySet<string> = new Set([
  'RecordBeforeSave',
  'RecordAfterSave',
  'RecordBeforeDelete',
  'PlatformEvent',
]);
/** The kind of trigger of a start that reads the records of its object on a schedule. */
export const ON_SCHEDULE = 'Scheduled';
/** The types of a process of the Process Builder that a record of its object sets off, as `ON_RECORDS`. */
export const PROCESS_ON_RECORDS: ReadonlySet<string> = new Set(['Workflow', 'CustomEvent']);

/** A name of an object or a field. */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;
/** A text that holds a merge field, or the start of one. */
const OPENS = '{!';

const HOLDS_NOTHING: MergeStart = { object: null };
const SOME_RECORD: MergeStart = { object: null, notKnown: 'record' };
const OUTPUTS: MergeStart = { object: null, notKnown: 'outputs' };

const isLeaf = (element: XmlElement): boolean => element.children.length === 0;
const fold = (name: string): string => name.toLowerCase();

/**
 * What each resource of a flow holds, by its name: a record of an object, something that holds no record, or
 * something of which that is not known. `undefined` for a name the flow does not have.
 *
 * `$Record` and `$Record__Prior` are a record of the object of the start. A record variable is one of the
 * object it declares. A lookup holds what it reads. A loop holds one of the list it goes over, and so does a
 * step that filters or sorts a list. A step that makes records of another object out of a list holds those.
 * What an action or a subflow gives back is of no known object, and neither is what a stage of an orchestration,
 * a step of it, a lookup of data or a filter of a list of the newer kinds holds.
 */
function resourcesOf(root: XmlElement): StartOf {
  const resources = new Map<string, () => MergeStart>();
  const set = (name: string | null, holds: () => MergeStart): void => {
    if (name !== null && !resources.has(fold(name))) resources.set(fold(name), holds);
  };
  const fixed = (holds: MergeStart) => (): MergeStart => holds;
  // A value that is not built like a name names no object: the element that holds it says that it is not read.
  const record = (object: string | null): MergeStart =>
    object === null || !NAME.test(object) ? SOME_RECORD : { object };

  /** What the list holds that an element goes over. A list that is named with a path is of no known object. */
  const resolving = new Set<string>();
  const ofList = (element: XmlElement) => (): MergeStart => {
    const list = textOf(childOf(element, 'collectionReference'));
    if (list === null || resolving.has(fold(list))) return SOME_RECORD;
    resolving.add(fold(list));
    try {
      return resources.get(fold(list))?.() ?? SOME_RECORD;
    } finally {
      resolving.delete(fold(list));
    }
  };

  const ofFields = (screen: XmlElement): void => {
    for (const field of childrenOf(screen, 'fields')) {
      // A component of a screen gives values back under names of its own. A plain field holds what was typed.
      set(
        textOf(childOf(field, 'name')),
        fixed(textOf(childOf(field, 'extensionName')) === null ? HOLDS_NOTHING : OUTPUTS),
      );
      ofFields(field);
    }
  };

  const object = textOf(childOf(childOf(root, 'start') ?? root, 'object'));
  if (childOf(root, 'start') !== null && object !== null) {
    set('$Record', fixed(record(object)));
    set('$Record__Prior', fixed(record(object)));
  }
  set('$Flow', fixed(HOLDS_NOTHING));
  // The empty text, true and false.
  set('$GlobalConstant', fixed(HOLDS_NOTHING));

  for (const element of root.children) {
    const group = element.local;
    if (isLeaf(element) || group === 'start' || NO_ELEMENTS.has(group)) continue;
    const name = textOf(childOf(element, 'name'));
    if (group === 'variables' || group === 'transforms') {
      const type = textOf(childOf(element, 'dataType'));
      const holds =
        type === 'SObject' ? record(textOf(childOf(element, 'objectType'))) : type === 'Apex' ? OUTPUTS : HOLDS_NOTHING;
      set(name, fixed(group === 'transforms' && type !== 'SObject' ? OUTPUTS : holds));
    } else if (group === 'recordLookups') {
      set(name, fixed(record(textOf(childOf(element, 'object')))));
    } else if (group === 'loops' || group === 'collectionProcessors') {
      const made = group === 'collectionProcessors' ? textOf(childOf(element, 'outputSObjectType')) : null;
      set(name, made === null ? ofList(element) : fixed(record(made)));
      // The name under which a step that filters a list knows the record it looks at.
      if (group === 'collectionProcessors')
        set(textOf(childOf(element, 'assignNextValueToReference')), ofList(element));
    } else if (group === 'actionCalls' || group === 'apexPluginCalls' || group === 'subflows') {
      set(name, fixed(OUTPUTS));
    } else if (group === 'orchestratedStages' || group === 'dataLookups' || group === 'collectionFilterCriteria') {
      set(name, fixed(OUTPUTS));
      for (const step of childrenOf(element, 'stageSteps')) set(textOf(childOf(step, 'name')), fixed(OUTPUTS));
    } else if (!KINDS.has(group)) {
      // An element of a kind that is not known: what it holds is not known either.
      set(name, fixed(OUTPUTS));
    } else {
      set(name, fixed(HOLDS_NOTHING));
      if (group === 'screens') ofFields(element);
      // The outcome of a decision and the event of a wait are names of the flow that hold no record.
      for (const inner of [...childrenOf(element, 'rules'), ...childrenOf(element, 'waitEvents')]) {
        set(textOf(childOf(inner, 'name')), fixed(HOLDS_NOTHING));
      }
    }
  }
  return (first) => resources.get(fold(first))?.();
}

/** The object the field names of an element are fields of, as far as the element says it. */
type FieldsOf =
  /** The object at the end of a path of relationships from `start`, which another reference holds. */
  | { readonly start: string; readonly through: readonly NameAt[] }
  /** Not known. `after` is the name that would have said it. */
  | { readonly after: NameAt | null };

/** The object a value names, as the object of the names of fields that follow. `null` for a value that is no name. */
const fieldsOf = (object: string | null): FieldsOf | null =>
  object === null || !NAME.test(object) ? null : { start: object, through: [] };

/** What is read of one element, while it is read. */
class Sink {
  readonly references: RawReference[] = [];
  readonly unread: Unread[] = [];
  readonly formulas: FormulaReading[] = [];
  readonly texts: MergeFieldsReading[] = [];
  readonly unknown: { element: string; line: number; column: number }[] = [];

  reading(attrs: Readonly<Record<string, JsonValue>>): ElementReading {
    const { references, unread, formulas, texts, unknown } = this;
    return { attrs, facts: null, references, unread, formulas, texts, unknown };
  }
}

/** Reads the elements of one flow. */
class Reader {
  readonly #document: XmlDocument;
  readonly #startOf: StartOf;
  /** The object of the start, if it names one: the object of `$Record`. */
  readonly #triggering: string | null;

  constructor(document: XmlDocument, startOf: StartOf, triggering: string | null) {
    this.#document = document;
    this.#startOf = startOf;
    this.#triggering = triggering;
  }

  #places(value: Value): PlaceOf {
    return placesIn(this.#document, value);
  }

  #refuse(sink: Sink, element: XmlElement, value: Value, why?: 'start'): void {
    const { name, line, column } = this.#places(value)(0, value.value.length);
    const text = cut(name, LONGEST_TEXT_SHOWN);
    sink.unread.push({ element: element.local, text, line, column, ...(why === undefined ? {} : { why }) });
  }

  /** A value that is the name of an object. */
  object(
    sink: Sink,
    element: XmlElement | null,
    said: { kind?: 'triggers-on'; op?: RecordOp; tier?: 'probable' },
  ): string | null {
    const value = valueOf(element);
    if (element === null || value === null) return null;
    if (!NAME.test(value.value)) {
      this.#refuse(sink, element, value);
      return null;
    }
    sink.references.push({ form: 'object', at: this.#places(value)(0, value.value.length), via: 'object', ...said });
    return value.value;
  }

  /** A value that is the name of a field of the object `of`. */
  field(
    sink: Sink,
    element: XmlElement,
    of: FieldsOf | null,
    said: { kind: 'reads' | 'writes' | 'references'; via: Via; tier?: 'probable' | undefined },
  ): void {
    const { kind, via, tier } = said;
    const more = tier === undefined ? {} : { tier };
    const value = valueOf(element);
    if (value === null) return;
    const at = this.#places(value);
    const names: NameAt[] = [];
    let from = 0;
    for (const part of value.value.split('.')) {
      names.push(at(from, from + part.length));
      from += part.length + 1;
    }
    if (names.some((one) => !NAME.test(one.name))) this.#refuse(sink, element, value);
    else if (of === null || !('start' in of)) {
      sink.references.push({ form: 'unfollowed', after: of?.after ?? null, names, via, ...more });
    } else {
      const silent = of.through.length;
      const path = [...of.through, ...names];
      sink.references.push({ form: 'path', start: of.start, names: path, kind, via, silent, ...more });
    }
  }

  /**
   * A value that is the name of a resource, with or without a path of fields. `kind` is what the element says
   * of the field at the end.
   */
  resource(
    sink: Sink,
    element: XmlElement,
    said: { kind: 'reads' | 'writes'; and?: 'writes'; tier?: 'probable' },
  ): void {
    const value = valueOf(element);
    if (value === null) return;
    const read = readResourceName(value.value, this.#startOf, this.#places(value), { via: 'path', ...said });
    if (read.references === null) this.#refuse(sink, element, value, read.why);
    else for (const reference of read.references) sink.references.push(reference);
  }

  /**
   * The record that an element writes or deletes as a whole: the name of a resource, and after it relationships
   * at most. Gives the object the fields of the element are of.
   */
  record(sink: Sink, element: XmlElement, op: RecordOp, tier?: 'probable'): FieldsOf {
    const value = valueOf(element);
    if (value === null) return { after: null };
    const at = this.#places(value);
    const names: NameAt[] = [];
    let from = 0;
    for (const part of value.value.split('.')) {
      names.push(at(from, from + part.length));
      from += part.length + 1;
    }
    const [first, ...rest] = names;
    if (
      first === undefined ||
      !/^\$?[A-Za-z][A-Za-z0-9_]*$/.test(first.name) ||
      rest.some((one) => !NAME.test(one.name))
    ) {
      this.#refuse(sink, element, value);
      return { after: null };
    }
    const start = this.#startOf(first.name);
    if (start === undefined) {
      this.#refuse(sink, element, value, first.name.startsWith('$') ? undefined : 'start');
      return { after: null };
    }
    const more = tier === undefined ? {} : { tier };
    if (start.object === null) {
      // Something that holds no record cannot be written as one. Of anything else, the object is not known.
      if (start.notKnown === undefined) this.#refuse(sink, element, value);
      else sink.references.push({ form: 'unfollowed', after: first, names: rest, via: 'record', ...more });
      return { after: rest.at(-1) ?? first };
    }
    const last = rest.at(-1) ?? first;
    sink.references.push({ form: 'record', start: start.object, names: rest, at: last, via: 'record', op, ...more });
    return { start: start.object, through: rest };
  }

  /** A value that is a formula of a flow. */
  formula(sink: Sink, element: XmlElement, tier?: 'probable'): void {
    const value = valueOf(element);
    if (value === null) return;
    const at = this.#places(value);
    sink.formulas.push(readFormulaOfMergeFields(value.value, this.#startOf, element.local, at, tier));
  }

  /** A value that is a text. Only its merge fields are read. */
  text(sink: Sink, element: XmlElement, tier?: 'probable'): void {
    const value = valueOf(element);
    if (value?.value.includes(OPENS) !== true) return;
    sink.texts.push(readMergeFields(value.value, this.#startOf, element.local, this.#places(value), tier));
  }

  /**
   * A condition that compares `RecordType.DeveloperName` of a record with a text: the text is the name of a
   * record type, if the object of the record has one of that name.
   */
  #recordType(sink: Sink, condition: XmlElement): void {
    const left = valueOf(childOf(condition, 'leftValueReference'));
    const right = childOf(condition, 'rightValue');
    const text = valueOf(right === null ? null : childOf(right, 'stringValue'));
    const operator = textOf(childOf(condition, 'operator'));
    if (left === null || text === null || !NAME.test(text.value)) return;
    if (operator !== 'EqualTo' && operator !== 'NotEqualTo') return;
    const parts = left.value.split('.');
    const [first, ...rest] = parts;
    if (first === undefined || rest.length < 2) return;
    if (fold(rest.at(-1) ?? '') !== 'developername' || fold(rest.at(-2) ?? '') !== 'recordtype') return;
    const start = this.#startOf(first);
    if (start === undefined || start.object === null) return;
    const at = this.#places(left);
    const names: NameAt[] = [];
    let from = first.length + 1;
    for (const part of rest.slice(0, -2)) {
      if (!NAME.test(part)) return;
      names.push(at(from, from + part.length));
      from += part.length + 1;
    }
    sink.references.push({
      form: 'record-type',
      start: start.object,
      names,
      at: this.#places(text)(0, text.value.length),
      via: 'text',
      tier: 'probable',
    });
  }

  /**
   * Reads what stands inside an element. `of` is the object the names of fields in it are of, as far as the
   * element says it. `tier` is given for an element of a kind this reader does not know: everything in it is
   * read by the same rules, and is less certain.
   */
  inside(sink: Sink, element: XmlElement, of: FieldsOf | null, tier?: 'probable'): void {
    const more = tier === undefined ? {} : { tier };
    this.#actions(sink, element, tier);
    for (const child of element.children) {
      const local = child.local;
      if (NO_ELEMENTS.has(local)) continue;
      if (!isLeaf(child)) {
        this.inside(sink, child, this.#fieldsIn(sink, element, child, of, tier), tier);
        if (local === 'conditions') this.#recordType(sink, child);
        continue;
      }
      if (local === 'name' || local === 'description' || local === 'label' || local.endsWith('Label')) continue;
      if (FORMULAS.has(local)) this.formula(sink, child, tier);
      else if (TEXTS.has(local)) this.text(sink, child, tier);
      else if (ELEMENT_NAMES.has(local) || NO_RESOURCES.has(local)) continue;
      else if (READS.has(local)) this.resource(sink, child, { kind: 'reads', ...more });
      else if (local === 'assignToReference' && element.local === 'assignmentItems') {
        const operator = textOf(childOf(element, 'operator'));
        const adds = operator !== null && !ONLY_WRITES.has(operator);
        this.resource(sink, child, adds ? { kind: 'reads', and: 'writes', ...more } : { kind: 'writes', ...more });
      } else if (WRITES.has(local)) this.resource(sink, child, { kind: 'writes', ...more });
      // A field of a screen that is bound to a field of a record shows the value and stores what is typed.
      else if (local === 'objectFieldReference') this.resource(sink, child, { kind: 'reads', and: 'writes', ...more });
      else if (local === 'inputReference') this.resource(sink, child, { kind: 'reads', ...more });
      // The field of a record that a step which makes records sets. No file here holds one.
      else if (local === 'assignToFieldReference' && element.local === 'mapItems') {
        this.field(sink, child, of, { kind: 'writes', via: 'assignment', tier: 'probable' });
      } else if (/References?$/.test(local)) {
        // The name of a resource in an element this reader has no rule for.
        const kind = local.startsWith('assign') ? 'writes' : 'reads';
        this.resource(sink, child, { kind, tier: 'probable' });
      } else if (this.#fieldName(sink, element, child, of, tier)) continue;
      else this.text(sink, child, 'probable');
    }
  }

  /**
   * The object the names of fields in the group `group` of the element `parent` are of. A group that holds
   * fields of the object of the element has its object `of`, and a group that names an object of its own has
   * that one. In any other group, a name of a field stands where no object is named.
   */
  #fieldsIn(
    sink: Sink,
    parent: XmlElement,
    group: XmlElement,
    of: FieldsOf | null,
    tier: 'probable' | undefined,
  ): FieldsOf | null {
    const more = tier === undefined ? {} : { tier };
    switch (group.local) {
      // The fields of a scheduled path and of a custom error are fields of the record that started the flow.
      case 'scheduledPaths':
      case 'customErrorMessages':
        return fieldsOf(this.#triggering);
      // The records of another object that a lookup reads with its own, through a relationship.
      case 'relatedRecords':
        return fieldsOf(this.object(sink, childOf(group, 'relatedObject'), { op: 'lookup', ...more }));
      // An event of a wait that waits for a change of the records of an object.
      case 'waitEvents':
        return fieldsOf(this.object(sink, childOf(group, 'object'), more));
      // What a step that makes records sets is a field of the records it makes. Their object is read with the step.
      case 'mapItems':
        return fieldsOf(textOf(childOf(parent, 'outputSObjectType')));
      default:
        return SAME_OBJECT.has(group.local) ? of : null;
    }
  }

  /** Reads `child` as the name of a field, if it is an element that holds one. */
  #fieldName(sink: Sink, parent: XmlElement, child: XmlElement, of: FieldsOf | null, tier?: 'probable'): boolean {
    const local = child.local;
    const field = (kind: 'reads' | 'writes' | 'references', via: Via, sure: 'probable' | undefined = tier): void => {
      this.field(sink, child, of, { kind, via, tier: sure });
    };
    if (local === 'field') {
      if (parent.local === 'filters') field('reads', 'filter');
      else if (parent.local === 'inputAssignments') field('writes', 'assignment');
      else if (parent.local === 'outputAssignments') field('reads', 'output');
      else return false;
    } else if (local === 'queriedFields' || local === 'displayField' || local === 'valueField')
      field('reads', 'output');
    else if (local === 'sortField') field('reads', 'sort');
    else if (local === 'recordField' && parent.local === 'scheduledPaths') field('reads', 'time');
    else if (local === 'fieldSelection') field('references', 'display-field');
    // The field an upsert finds its records by.
    else if (local === 'upsertExternalIdField' || local === 'upsertStandardIdField') field('reads', 'filter');
    // The field that relates the records of another object to those of a lookup. No file here holds one, and it is
    // not known on which side Salesforce writes it: it is read as a field of the other object.
    else if (local === 'relationshipField' && parent.local === 'relatedRecords') field('reads', 'filter', 'probable');
    else if (local === 'outputFieldApiName') {
      // What a transform sets. Where it makes no record, it is a property of an Apex type and no field.
      if (of !== null && 'start' in of) field('writes', 'assignment', 'probable');
    } else if (local === 'picklistField') {
      const picklist = fieldsOf(textOf(childOf(parent, 'picklistObject')));
      this.field(sink, child, picklist, { kind: 'references', via: 'picklist', tier });
    } else return false;
    return true;
  }

  /**
   * What the actions an element names start: an Apex class, another flow or an email alert. An element can name
   * an action, and also one it runs when it starts or ends, each with its type.
   */
  #actions(sink: Sink, element: XmlElement, tier: 'probable' | undefined): void {
    for (const action of ACTIONS) {
      const type = textOf(childOf(element, `${action}Type`));
      const starts = type === null ? undefined : STARTS.get(type);
      const holder = childOf(element, `${action}Name`);
      if (starts !== undefined && holder !== null) this.#started(sink, holder, starts, tier);
    }
  }

  /** The name of what an action starts, in `holder`. */
  #started(
    sink: Sink,
    holder: XmlElement,
    starts: { type: string; kind: 'calls' | 'references'; tier?: 'probable' },
    tier: 'probable' | undefined,
  ): void {
    const { type, kind } = starts;
    const sure = tier ?? starts.tier;
    const value = valueOf(holder);
    if (value === null) return;
    // The name of an alert starts with its object. The reference stands at the name of the alert.
    const from = type === 'WorkflowAlert' ? value.value.lastIndexOf('.') + 1 : 0;
    const at = this.#places(value)(from, value.value.length);
    if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(value.value) || at.name === '') this.#refuse(sink, holder, value);
    else {
      const more = sure === undefined ? {} : { tier: sure };
      sink.references.push({ form: 'component', type, at, fullName: value.value, kind, via: 'action', ...more });
    }
  }

  /** What a subflow and an Apex plug-in start: another flow and an Apex class. */
  started(sink: Sink, element: XmlElement, group: string): void {
    if (group === 'subflows') {
      const holder = childOf(element, 'flowName');
      if (holder !== null) this.#started(sink, holder, { type: 'Flow', kind: 'calls' }, undefined);
    } else if (group === 'apexPluginCalls') {
      const holder = childOf(element, 'apexClass');
      if (holder !== null) this.#started(sink, holder, { type: 'ApexClass', kind: 'calls' }, undefined);
    }
  }
}

/**
 * Reads the file of a flow. `document` is the file, whose root element is `Flow`.
 *
 * An element of a kind this reader does not know is read all the same, by the rules of the elements it knows:
 * the names in it are recorded as less certain, and the reading says of which kind it is.
 */
export function readFlow(document: XmlDocument): FlowReading {
  const root = document.root;
  const startOf = resourcesOf(root);
  const start = childOf(root, 'start');
  const status = textOf(childOf(root, 'status'));
  const processType = textOf(childOf(root, 'processType'));
  const active = status === null ? {} : { active: status === 'Active' };
  const triggering = start === null ? null : textOf(childOf(start, 'object'));
  const reader = new Reader(document, startOf, triggering !== null && NAME.test(triggering) ? triggering : null);

  const own = new Sink();
  const elements: FlowElement[] = [];
  const nameless: { group: string; line: number; column: number }[] = [];
  const placeOf = (element: XmlElement): { line: number; column: number } => {
    const { line, column } = document.place(element.start);
    return { line, column };
  };

  for (const element of root.children) {
    const group = element.local;
    // An element of a known kind that holds nothing has no name either.
    if (isLeaf(element) && KINDS.has(group) && group !== 'start') {
      nameless.push({ group, ...placeOf(element) });
      continue;
    }
    if (isLeaf(element)) {
      // A setting of the flow. The label of an interview is a text with merge fields.
      if (group === 'interviewLabel') reader.text(own, element);
      else if (group !== 'description' && group !== 'label') reader.text(own, element, 'probable');
      continue;
    }
    if (group === 'processMetadataValues') {
      // A process of the Process Builder has no start. It names its object in a value of the builder.
      if (textOf(childOf(element, 'name')) !== 'ObjectType') continue;
      const value = childOf(element, 'value');
      const sets = processType !== null && PROCESS_ON_RECORDS.has(processType);
      reader.object(own, value === null ? null : childOf(value, 'stringValue'), sets ? { kind: 'triggers-on' } : {});
      continue;
    }
    if (NO_ELEMENTS.has(group)) continue;

    const kind = KINDS.get(group);
    const name = group === 'start' ? START : textOf(childOf(element, 'name'));
    const sink = name === null ? own : new Sink();
    const tier = kind === undefined ? ('probable' as const) : undefined;
    if (kind === undefined) sink.unknown.push({ element: group, ...placeOf(element) });
    else if (name === null) {
      nameless.push({ group, ...placeOf(element) });
      continue;
    }

    let of: FieldsOf | null = null;
    const attrs: Record<string, JsonValue> = {
      kind: kind ?? 'unknown',
      ...(kind === undefined ? { element: group } : {}),
    };
    if (group === 'start') {
      const trigger = textOf(childOf(element, 'triggerType'));
      // Where neither a record nor a schedule sets the flow off, nothing more is said of the object.
      const said =
        trigger === ON_SCHEDULE
          ? { op: 'lookup' as const }
          : trigger !== null && ON_RECORDS.has(trigger)
            ? { kind: 'triggers-on' as const }
            : {};
      of = fieldsOf(reader.object(sink, childOf(element, 'object'), said));
    } else if (OPS.has(group)) {
      const op = opOf(group, element);
      // A set of choices that is made of a list or of the values of a picklist reads no records.
      const reads =
        group !== 'dynamicChoiceSets' ||
        ['collectionReference', 'picklistField'].every((one) => childOf(element, one) === null);
      const object = reader.object(sink, childOf(element, 'object'), reads ? { op } : {});
      const whole = childOf(element, 'inputReference');
      // An element that names a record to write has the fields of that record, and no object of its own.
      const written = whole === null ? null : reader.record(sink, whole, op);
      of = object !== null ? { start: object, through: [] } : written;
    } else if (group === 'collectionProcessors') {
      // The fields a step sorts a list by are fields of the records of that list. A step that makes records of
      // another object names it.
      const list = textOf(childOf(element, 'collectionReference'));
      of = fieldsOf(list === null ? null : (startOf(list)?.object ?? null));
      reader.object(sink, childOf(element, 'outputSObjectType'), {});
    } else if (group === 'transforms' && textOf(childOf(element, 'dataType')) === 'SObject') {
      // A transform that makes a record sets fields of the object it declares.
      of = fieldsOf(textOf(childOf(element, 'objectType')));
    } else if (kind === undefined) {
      // The object an element of an unknown kind names is the one the names of fields in it are of.
      of = fieldsOf(reader.object(sink, childOf(element, 'object'), { tier: 'probable' }));
    }
    if (kind !== undefined) reader.started(sink, element, group);
    const actionType = group === 'actionCalls' ? textOf(childOf(element, 'actionType')) : null;
    if (actionType !== null) attrs['actionType'] = actionType;

    // The record an element writes as a whole was read above, with what the element does to it.
    const rest = OPS.has(group)
      ? { ...element, children: element.children.filter((child) => child.local !== 'inputReference') }
      : element;
    reader.inside(sink, rest, of, tier);
    if (name !== null) elements.push({ name, element, reading: sink.reading({ ...attrs, ...active }) });
  }

  const trigger = start === null ? null : textOf(childOf(start, 'triggerType'));
  const records = start === null ? null : textOf(childOf(start, 'recordTriggerType'));
  return {
    flow: own.reading({
      ...(status === null ? {} : { status }),
      ...active,
      ...(processType === null ? {} : { processType }),
      ...(trigger === null ? {} : { triggerType: trigger }),
      ...(records === null ? {} : { recordTriggerType: records }),
    }),
    elements,
    nameless,
  };
}
