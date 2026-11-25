/**
 * What a report type says (decision record 0077): the object it is built on, the child relationships it joins and
 * the fields it lists.
 *
 * A report type starts at its base object and joins a child relationship of it, and of each object it joins one
 * more, as deep as its `join` elements go. The reference of a join goes to the lookup field of the child object that
 * defines the relationship, as the answer key has it for a child relationship of a query. A field the report type
 * lists stands in a table, which names the base object and the joins that lead to the object of the field:
 * `Invoice__c.Lines__r`. The field can be a path through lookup fields, which a report type names by the field,
 * `Account__c.Tier__c`, where a formula names the relationship. A lookup field of Salesforce is named by its
 * relationship: `Owner` is the field `OwnerId`.
 *
 * Only the reading is done here. The names are resolved against the model of all objects, which exists only once
 * every file was read (`raw-references.ts`).
 */
import { foldName } from '../core/keys.ts';
import { standardLookupField, type PathHint } from './model.ts';
import { Reader, type ElementReading } from './objects.ts';
import { relationshipOf } from './raw-references.ts';
import type { NameAt } from './values.ts';
import { childOf, childrenOf, type XmlDocument, type XmlElement } from './xml.ts';

/** What the element of a report type says. */
export function readReportType(document: XmlDocument, element: XmlElement): ElementReading {
  const reader = new Reader(document);
  const baseAt = reader.nameAt(childOf(element, 'baseObject'));
  if (baseAt !== null) reader.references.push({ form: 'object', at: baseAt, via: 'object' });
  const base = baseAt?.name ?? null;

  // Each join holds the next, which joins a child relationship of the object the one around it joins.
  const joins: string[] = [];
  for (let join = childOf(element, 'join'); join !== null && base !== null; join = childOf(join, 'join')) {
    const at = reader.nameAt(childOf(join, 'relationship'));
    if (at === null) break;
    reader.references.push({ form: 'join', start: base, joins: [...joins], at, via: 'join' });
    joins.push(at.name);
  }

  for (const section of childrenOf(element, 'sections')) {
    for (const column of childrenOf(section, 'columns')) {
      const tableElement = childOf(column, 'table');
      const table = reader.pathOf(tableElement);
      const names = reader.pathOf(childOf(column, 'field'));
      if (base === null || table === null || names === null) continue;
      const [first, ...through] = table;
      // A table starts at the base object. Any other is not read.
      if (first === undefined || foldName(first.name) !== foldName(base)) {
        reader.refuse(tableElement, 'start');
        continue;
      }
      const hinted = names.map((at, index): NameAt & PathHint => {
        if (index < names.length - 1) return { ...at, asRelationship: relationshipOf(at.name) };
        const field = standardLookupField(at.name);
        return field === undefined ? at : { ...at, resolveAs: field };
      });
      const joined = through.map((one) => one.name);
      reader.references.push({ form: 'column', start: base, joins: joined, names: hinted, via: 'listed-field' });
    }
  }
  return { attrs: {}, facts: null, references: reader.references, unread: reader.unread, formulas: reader.formulas };
}
