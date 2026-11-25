/**
 * What a quick action says (decision record 0077): the object whose records it creates and their record type, the
 * fields it sets, the names in the formulas of the values it sets them to, the fields its layout shows, the email
 * template it starts with, and the flow, component, page or canvas app it opens.
 *
 * An action of an object runs on a record of that object and is named after it: `Invoice__c.New_Line`. A global
 * action runs on no record. An action that creates records names their object (`targetObject`), their record type
 * (`targetRecordType`, `Opportunity.Donation`) and the lookup field of that object that it sets to the record it
 * runs on (`targetParentField`). An action that updates the record it runs on names no object: it sets fields of
 * the object of the action. A predefined value sets a field to a text or to a formula, and the formula names a
 * field of the record the action runs on by its object: `Invoice__c.Amount__c`. The layout of an action lists the
 * fields its form shows, of the same object, as a field set lists the fields of its object. A field the user can
 * type in (`uiBehavior` `Edit` or `Required`) is shown and set, as a field of a screen of a flow is.
 *
 * Only the reading is done here. The names are resolved against the model of all objects, which exists only once
 * every file was read (`raw-references.ts`).
 */
import { foldName } from '../core/keys.ts';
import { standardLookupField, type PathHint } from './model.ts';
import { readFormulaOfStarts, type StartOf } from './names-in-text.ts';
import { Reader, type ElementReading } from './objects.ts';
import type { Via } from './raw-references.ts';
import { placesIn, textOf, valueOf, type NameAt } from './values.ts';
import { childOf, childrenOf, type XmlDocument, type XmlElement } from './xml.ts';

/** The elements that name what an action opens, and the type of each. A flow is started, and so called. */
const OPENS: readonly { readonly element: string; readonly type: string; readonly kind?: 'calls' }[] = [
  { element: 'flowDefinition', type: 'Flow', kind: 'calls' },
  { element: 'lightningComponent', type: 'AuraDefinitionBundle' },
  { element: 'lightningWebComponent', type: 'LightningComponentBundle' },
  { element: 'page', type: 'ApexPage' },
  { element: 'canvas', type: 'ConnectedApp' },
];

/** What the layout of an action does with a field, by the folded value of `uiBehavior`: the user can type in it. */
const TYPED_IN: ReadonlySet<string> = new Set(['edit', 'required']);

/** What the element of a quick action says. `fullName` is the full name of the action. */
export function readQuickAction(document: XmlDocument, element: XmlElement, fullName: string): ElementReading {
  const reader = new Reader(document);
  const dot = fullName.indexOf('.');
  /** The object of the record the action runs on. `null` for a global action. */
  const own = dot === -1 ? null : fullName.slice(0, dot);

  const targetElement = childOf(element, 'targetObject');
  const targetAt = reader.nameAt(targetElement);
  if (targetAt !== null) reader.references.push({ form: 'object', at: targetAt, via: 'object' });
  /** The object of the records the action sets fields of. `null` where nothing says it. */
  const target = textOf(targetElement) === null ? own : (targetAt?.name ?? null);

  // The record type of the records it creates, by the name of its object and its own: `Opportunity.Donation`.
  const recordTypeElement = childOf(element, 'targetRecordType');
  const recordType = reader.pathOf(recordTypeElement);
  if (recordType !== null) {
    const [, name] = recordType;
    if (recordType.length !== 2 || name === undefined) reader.refuse(recordTypeElement);
    else {
      const typeName = recordType.map((one) => one.name).join('.');
      reader.references.push({
        form: 'component',
        type: 'RecordType',
        at: name,
        fullName: typeName,
        via: 'assignment',
      });
    }
  }

  /**
   * A field of that object, which the action writes or its layout shows. `and` is a second thing the action does
   * with it. `named` is where the name is looked up.
   */
  const ofTarget = (
    at: NameAt,
    kind: 'writes' | 'reads',
    via: Via,
    and?: 'writes',
    named: NameAt & PathHint = at,
  ): void => {
    reader.references.push(
      target === null
        ? { form: 'unfollowed', after: null, names: [at], via }
        : { form: 'path', start: target, names: [named], kind, ...(and === undefined ? {} : { and }), via },
    );
  };
  // The lookup field to the record the action runs on. A lookup field of Salesforce is named by its relationship.
  const parentAt = reader.nameAt(childOf(element, 'targetParentField'));
  if (parentAt !== null) {
    const field = standardLookupField(parentAt.name);
    ofTarget(
      parentAt,
      'writes',
      'assignment',
      undefined,
      field === undefined ? parentAt : { ...parentAt, resolveAs: field },
    );
  }

  const startOf: StartOf = (first) => (own !== null && foldName(first) === foldName(own) ? { object: own } : undefined);
  for (const override of childrenOf(element, 'fieldOverrides')) {
    const at = reader.nameAt(childOf(override, 'field'));
    if (at !== null) ofTarget(at, 'writes', 'assignment');
    const value = valueOf(childOf(override, 'formula'));
    if (value !== null) {
      reader.formulas.push(readFormulaOfStarts(value.value, startOf, 'formula', placesIn(document, value)));
    }
  }

  // The fields of the form, in the columns of its layout. An item can be an empty space, which names nothing. A
  // field the user types in is also set.
  const layout = childOf(element, 'quickActionLayout');
  for (const column of layout === null ? [] : childrenOf(layout, 'quickActionLayoutColumns')) {
    for (const item of childrenOf(column, 'quickActionLayoutItems')) {
      const at = reader.nameAt(childOf(item, 'field'));
      const typedIn = TYPED_IN.has(foldName(textOf(childOf(item, 'uiBehavior')) ?? ''));
      if (at !== null) ofTarget(at, 'reads', 'listed-field', typedIn ? 'writes' : undefined);
    }
  }

  // The email template an action that sends email starts with, by its folder and its name.
  const options = childOf(element, 'quickActionSendEmailOptions');
  reader.inFolder(options === null ? null : childOf(options, 'defaultEmailTemplateName'), 'EmailTemplate', 'template');

  for (const { element: local, type, kind } of OPENS) {
    reader.name(childOf(element, local), (at) => ({
      form: 'component',
      type,
      at,
      ...(kind === undefined ? {} : { kind }),
      via: 'action',
    }));
  }
  return { attrs: {}, facts: null, references: reader.references, unread: reader.unread, formulas: reader.formulas };
}
