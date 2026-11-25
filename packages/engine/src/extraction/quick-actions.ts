/**
 * What a quick action says (decision record 0077): the object whose records it creates, the fields it sets, the
 * names in the formulas of the values it sets them to, the fields its layout shows, and the flow, component or
 * page it opens.
 *
 * An action of an object runs on a record of that object and is named after it: `Invoice__c.New_Line`. A global
 * action runs on no record. An action that creates records names their object (`targetObject`) and the lookup
 * field of that object that it sets to the record it runs on (`targetParentField`). An action that updates the
 * record it runs on names no object: it sets fields of the object of the action. A predefined value sets a field
 * to a text or to a formula, and the formula names a field of the record the action runs on by its object:
 * `Invoice__c.Amount__c`. The layout of an action lists the fields its form shows, of the same object, as a field
 * set lists the fields of its object.
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
];

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

  /** A field of that object, which the action writes or its layout shows. `named` is where the name is looked up. */
  const ofTarget = (at: NameAt, kind: 'writes' | 'reads', via: Via, named: NameAt & PathHint = at): void => {
    reader.references.push(
      target === null
        ? { form: 'unfollowed', after: null, names: [at], via }
        : { form: 'path', start: target, names: [named], kind, via },
    );
  };
  // The lookup field to the record the action runs on. A lookup field of Salesforce is named by its relationship.
  const parentAt = reader.nameAt(childOf(element, 'targetParentField'));
  if (parentAt !== null) {
    const field = standardLookupField(parentAt.name);
    ofTarget(parentAt, 'writes', 'assignment', field === undefined ? parentAt : { ...parentAt, resolveAs: field });
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

  // The fields of the form, in the columns of its layout. An item can be an empty space, which names nothing.
  const layout = childOf(element, 'quickActionLayout');
  for (const column of layout === null ? [] : childrenOf(layout, 'quickActionLayoutColumns')) {
    for (const item of childrenOf(column, 'quickActionLayoutItems')) {
      const at = reader.nameAt(childOf(item, 'field'));
      if (at !== null) ofTarget(at, 'reads', 'listed-field');
    }
  }

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
