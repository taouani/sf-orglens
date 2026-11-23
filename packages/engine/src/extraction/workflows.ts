/**
 * What a file of workflow rules says (decision record 0063). Salesforce keeps the rules of an object and the
 * actions they start in one file, named after the object, and names each rule and each action `<object>.<name>`.
 * The file is a component, and so is each rule and each action in it.
 *
 * A rule reads the fields of its criteria and of its formula, and refers to the actions it starts, at once and
 * after a time. A field update writes its field, on the object or on the parent a relationship field leads to,
 * and reads the fields of its formula, which is about the object of the file. An alert reads the fields that hold
 * its recipients and refers to its email template. An outbound message reads the fields it sends. A task reads
 * the date field its due date counts from.
 *
 * Only the reading is done here. The names are resolved against the model of all objects, which exists only
 * once every file was read (`raw-references.ts`).
 */
import type { JsonValue } from '../core/errors.ts';
import { Reader, type ElementReading } from './objects.ts';
import { textOf } from './values.ts';
import { childOf, childrenOf, type XmlDocument, type XmlElement } from './xml.ts';

/**
 * The type of the component an action of a rule is, by the type the rule gives the action (`actions/type`). The
 * names are those of `@salesforce/types`, and a test holds them against it. Two of them are no part of a file of
 * workflow rules that the Salesforce library knows: it knows no `WorkflowNotification`, and `WorkflowFlowAutomation`
 * only as a type of its own, of which the test org lists components and hands out none. An action of such a type
 * is a reference that is not resolved where the snapshot holds no such component.
 */
export const ACTION_TYPES: ReadonlyMap<string, string> = new Map([
  ['Alert', 'WorkflowAlert'],
  ['FieldUpdate', 'WorkflowFieldUpdate'],
  ['FlowAction', 'WorkflowFlowAction'],
  ['FlowAutomation', 'WorkflowFlowAutomation'],
  ['KnowledgePublish', 'WorkflowKnowledgePublish'],
  ['Notification', 'WorkflowNotification'],
  ['OutboundMessage', 'WorkflowOutboundMessage'],
  ['Send', 'WorkflowSend'],
  ['Task', 'WorkflowTask'],
]);

/**
 * The parts of a file of workflow rules that are read. A part of another type, such as a flow action or a
 * knowledge action, is a component that is not read.
 */
export const WORKFLOW_PARTS: ReadonlySet<string> = new Set([
  'WorkflowAlert',
  'WorkflowFieldUpdate',
  'WorkflowOutboundMessage',
  'WorkflowRule',
  'WorkflowTask',
]);

/** What the file itself says: nothing. Its rules and actions are components that are read on their own. */
export function readWorkflow(): ElementReading {
  return { attrs: {}, facts: null, references: [], unread: [], formulas: [] };
}

/**
 * What the element of a part of a file of workflow rules says. `type` is one of `WORKFLOW_PARTS`, and `object`
 * the name of the object the file is of.
 */
export function readWorkflowPart(
  type: string,
  document: XmlDocument,
  element: XmlElement,
  object: string,
): ElementReading {
  const reader = new Reader(document);
  const attrs: Record<string, JsonValue> = {};
  /** The fields a value names as a list, each a field of the object. */
  const listed = (elements: readonly XmlElement[], via: 'listed-field'): void => {
    for (const one of elements) {
      const at = reader.nameAt(one);
      if (at !== null) reader.references.push({ form: 'path', start: object, names: [at], kind: 'reads', via });
    }
  };

  if (type === 'WorkflowRule') {
    for (const item of childrenOf(element, 'criteriaItems')) {
      reader.path(childOf(item, 'field'), object, 'reads', 'filter');
      reader.path(childOf(item, 'valueField'), object, 'reads', 'filter');
    }
    reader.formula(childOf(element, 'formula'), object);
    const started = (actions: readonly XmlElement[]): void => {
      for (const action of actions) {
        const type = childOf(action, 'type');
        const kind = textOf(type);
        const target = kind === null ? undefined : ACTION_TYPES.get(kind);
        // An action of a type that is not known here names nothing that could be found: it is not read, and a
        // warning says so. So does an action without a type, which Salesforce refuses.
        if (target === undefined) reader.refuse(kind === null ? childOf(action, 'name') : type, 'action-type');
        else {
          // An action is of the object of the rule, and Salesforce names it with that object.
          reader.name(childOf(action, 'name'), (at) => ({
            form: 'component',
            type: target,
            at,
            fullName: `${object}.${at.name}`,
            via: 'action',
          }));
        }
      }
    };
    started(childrenOf(element, 'actions'));
    for (const trigger of childrenOf(element, 'workflowTimeTriggers')) {
      started(childrenOf(trigger, 'actions'));
      reader.path(childOf(trigger, 'offsetFromField'), object, 'reads', 'time');
    }
    const active = textOf(childOf(element, 'active'));
    if (active === 'true' || active === 'false') attrs['active'] = active === 'true';
  } else if (type === 'WorkflowFieldUpdate') {
    const field = reader.nameAt(childOf(element, 'field'));
    const parent = childOf(element, 'targetObject');
    if (parent === null) {
      if (field !== null) {
        reader.references.push({ form: 'path', start: object, names: [field], kind: 'writes', via: 'assignment' });
      }
    } else {
      // An update of a field of the parent names the relationship field it goes through.
      const through = reader.nameAt(parent);
      if (field !== null && through !== null) {
        reader.references.push({ form: 'parent-field', start: object, through, at: field, via: 'assignment' });
      } else if (field !== null) {
        reader.references.push({ form: 'unfollowed', after: null, names: [field], via: 'assignment' });
      }
    }
    // The formula is about the record of the object of the file, also where the update writes on its parent.
    reader.formula(childOf(element, 'formula'), object);
  } else if (type === 'WorkflowAlert') {
    listed(
      childrenOf(element, 'recipients').flatMap((one) => {
        const field = childOf(one, 'field');
        return field === null ? [] : [field];
      }),
      'listed-field',
    );
    reader.inFolder(childOf(element, 'template'), 'EmailTemplate', 'template');
  } else if (type === 'WorkflowOutboundMessage') {
    listed(childrenOf(element, 'fields'), 'listed-field');
  } else if (type === 'WorkflowTask') {
    reader.path(childOf(element, 'offsetFromField'), object, 'reads', 'time');
  }
  return { attrs, facts: null, references: reader.references, unread: reader.unread, formulas: reader.formulas };
}
