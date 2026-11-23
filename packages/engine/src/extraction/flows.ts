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
export const START = 'flow-start';

/** One element or resource of a flow. */
export interface FlowElement {
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
 * The kinds of element and resource, by the name of the element of the file that holds one. The names up to
 * API version 48 are those of the types the Salesforce library has for a flow. `customErrors` is in the fixture
 * project, which a test org accepted. `collectionProcessors`, `orchestratedStages`, `recordRollbacks` and
 * `transforms` are written as the author knows them, and no file here holds one.
 */
const KINDS: ReadonlyMap<string, string> = new Map(
  Object.entries({
    actionCalls: 'action',
    apexPluginCalls: 'apex-plugin',
    assignments: 'assignment',
    choices: 'choice',
    collectionProcessors: 'collection-processor',
    constants: 'constant',
    customErrors: 'custom-error',
    decisions: 'decision',
    dynamicChoiceSets: 'choice-set',
    formulas: 'formula',
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

/** Groups of the file that hold values of the builder and no element. Nothing in them is a name. */
const NO_ELEMENTS: ReadonlySet<string> = new Set(['processMetadataValues', 'customProperties']);

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
/** The operators of an assignment that write a value and do not read the one that was there. */
const ONLY_WRITES: ReadonlySet<string> = new Set(['Assign', 'AssignCount']);

/** The kinds of trigger of a start that a record of its object sets off, and the one that reads records on a schedule. */
const ON_SCHEDULE: ReadonlySet<string> = new Set(['Scheduled', 'ScheduledJourney']);

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
 * step that filters or sorts a list. What an action or a subflow gives back is of no known object.
 */
export function resourcesOf(root: XmlElement): StartOf {
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
    if (list === null || list.includes('.') || resolving.has(fold(list))) return SOME_RECORD;
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
      set(name, ofList(element));
      // The name under which a step that filters a list knows the record it looks at.
      if (group === 'collectionProcessors')
        set(textOf(childOf(element, 'assignNextValueToReference')), ofList(element));
    } else if (group === 'actionCalls' || group === 'apexPluginCalls' || group === 'subflows') {
      set(name, fixed(OUTPUTS));
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
  field(sink: Sink, element: XmlElement, of: FieldsOf | null, kind: 'reads' | 'writes' | 'references', via: Via): void {
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
      sink.references.push({ form: 'unfollowed', after: of?.after ?? null, names, via });
    } else {
      const silent = of.through.length;
      sink.references.push({ form: 'path', start: of.start, names: [...of.through, ...names], kind, via, silent });
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
  formula(sink: Sink, element: XmlElement): void {
    const value = valueOf(element);
    if (value === null) return;
    sink.formulas.push(readFormulaOfMergeFields(value.value, this.#startOf, element.local, this.#places(value)));
  }

  /** A value that is a text. Only its merge fields are read. */
  text(sink: Sink, element: XmlElement, tier?: 'probable'): void {
    const value = valueOf(element);
    if (value === null || !value.value.includes(OPENS)) return;
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
   * Reads what stands inside an element. `of` is the object the field names in it are of, and `undefined`
   * where the kind of the element is not known: nothing says then which element holds the name of a field.
   */
  inside(sink: Sink, element: XmlElement, of: FieldsOf | null | undefined, tier?: 'probable'): void {
    const more = tier === undefined ? {} : { tier };
    for (const child of element.children) {
      const local = child.local;
      if (NO_ELEMENTS.has(local)) continue;
      if (!isLeaf(child)) {
        // The fields of a scheduled path and of a custom error are fields of the record that started the flow.
        const own =
          of !== undefined && (local === 'scheduledPaths' || local === 'customErrorMessages')
            ? this.#triggering === null
              ? null
              : { start: this.#triggering, through: [] }
            : of;
        this.inside(sink, child, own, tier);
        if (local === 'conditions') this.#recordType(sink, child);
        continue;
      }
      if (local === 'name' || local === 'description' || local === 'label' || local.endsWith('Label')) {
        if (local === 'interviewLabel') this.text(sink, child, tier);
        continue;
      }
      if (FORMULAS.has(local)) this.formula(sink, child);
      else if (TEXTS.has(local)) this.text(sink, child, tier);
      else if (ELEMENT_NAMES.has(local)) continue;
      else if (READS.has(local)) this.resource(sink, child, { kind: 'reads', ...more });
      else if (local === 'assignToReference' && element.local === 'assignmentItems') {
        const operator = textOf(childOf(element, 'operator'));
        const adds = operator !== null && !ONLY_WRITES.has(operator);
        this.resource(sink, child, adds ? { kind: 'reads', and: 'writes', ...more } : { kind: 'writes', ...more });
      } else if (WRITES.has(local)) this.resource(sink, child, { kind: 'writes', ...more });
      // A field of a screen that is bound to a field of a record shows the value and stores what is typed.
      else if (local === 'objectFieldReference') this.resource(sink, child, { kind: 'reads', and: 'writes', ...more });
      else if (local === 'inputReference') this.resource(sink, child, { kind: 'reads', ...more });
      else if (/References?$/.test(local)) {
        // The name of a resource in an element this reader has no rule for.
        const kind = local.startsWith('assign') ? 'writes' : 'reads';
        this.resource(sink, child, { kind, tier: 'probable' });
      } else if (of !== undefined && this.#fieldName(sink, element, child, of)) continue;
      else this.text(sink, child, 'probable');
    }
  }

  /** Reads `child` as the name of a field, if it is an element that holds one. */
  #fieldName(sink: Sink, parent: XmlElement, child: XmlElement, of: FieldsOf | null): boolean {
    const local = child.local;
    if (local === 'field') {
      if (parent.local === 'filters') this.field(sink, child, of, 'reads', 'filter');
      else if (parent.local === 'inputAssignments') this.field(sink, child, of, 'writes', 'assignment');
      else if (parent.local === 'outputAssignments') this.field(sink, child, of, 'reads', 'output');
      else return false;
    } else if (local === 'queriedFields' || local === 'displayField' || local === 'valueField') {
      this.field(sink, child, of, 'reads', 'output');
    } else if (local === 'sortField') this.field(sink, child, of, 'reads', 'sort');
    else if (local === 'recordField' && parent.local === 'scheduledPaths') this.field(sink, child, of, 'reads', 'time');
    else if (local === 'fieldSelection') this.field(sink, child, of, 'references', 'display-field');
    else if (local === 'picklistField') {
      const object = textOf(childOf(parent, 'picklistObject'));
      this.field(sink, child, object === null ? null : { start: object, through: [] }, 'references', 'picklist');
    } else return false;
    return true;
  }

  /** What an action starts: an Apex class, another flow or an email alert. */
  started(sink: Sink, element: XmlElement, group: string): void {
    const named = (type: string, kind: 'calls' | 'references', holder: XmlElement | null): void => {
      const value = valueOf(holder);
      if (holder === null || value === null) return;
      // The name of an alert starts with its object. The reference stands at the name of the alert.
      const from = type === 'WorkflowAlert' ? value.value.lastIndexOf('.') + 1 : 0;
      const at = this.#places(value)(from, value.value.length);
      if (!/^[A-Za-z][A-Za-z0-9_.]*$/.test(value.value) || at.name === '') this.#refuse(sink, holder, value);
      else sink.references.push({ form: 'component', type, at, fullName: value.value, kind, via: 'action' });
    };
    if (group === 'subflows') named('Flow', 'calls', childOf(element, 'flowName'));
    else if (group === 'apexPluginCalls') named('ApexClass', 'calls', childOf(element, 'apexClass'));
    else if (group === 'actionCalls') {
      const type = textOf(childOf(element, 'actionType'));
      const name = childOf(element, 'actionName');
      if (type === 'apex') named('ApexClass', 'calls', name);
      else if (type === 'flow') named('Flow', 'calls', name);
      else if (type === 'emailAlert') named('WorkflowAlert', 'references', name);
    }
  }
}

/**
 * Reads the file of a flow. `document` is the file, whose root element is `Flow`.
 *
 * An element of a kind this reader does not know is read all the same: the names of resources and the merge
 * fields in it are recorded as less certain, and the reading says of which kind it is.
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
      const said = processType === 'Workflow' ? { kind: 'triggers-on' as const } : {};
      reader.object(own, value === null ? null : childOf(value, 'stringValue'), said);
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

    let of: FieldsOf | null | undefined = kind === undefined ? undefined : null;
    const attrs: Record<string, JsonValue> = {
      kind: kind ?? 'unknown',
      ...(kind === undefined ? { element: group } : {}),
    };
    if (group === 'start') {
      const trigger = textOf(childOf(element, 'triggerType'));
      const said =
        trigger !== null && ON_SCHEDULE.has(trigger) ? { op: 'lookup' as const } : { kind: 'triggers-on' as const };
      const object = reader.object(sink, childOf(element, 'object'), said);
      of = object === null ? null : { start: object, through: [] };
    } else if (OPS.has(group)) {
      const op = OPS.get(group) ?? 'lookup';
      const object = reader.object(sink, childOf(element, 'object'), { op });
      const whole = childOf(element, 'inputReference');
      // An element that names a record to write has the fields of that record, and no object of its own.
      const written = whole === null || group === 'recordLookups' ? null : reader.record(sink, whole, op);
      of = object !== null ? { start: object, through: [] } : written;
    }
    if (kind !== undefined) reader.started(sink, element, group);
    const actionType = group === 'actionCalls' ? textOf(childOf(element, 'actionType')) : null;
    if (actionType !== null) attrs['actionType'] = actionType;

    // The record an element writes as a whole was read above, with what the element does to it.
    const rest =
      OPS.has(group) && group !== 'recordLookups'
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
