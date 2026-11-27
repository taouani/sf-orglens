/**
 * What a record of a custom metadata type says (decision record 0065): the type it is a record of, the fields of
 * the type it gives a value, and the values that can be names.
 *
 * A record is a file of its own, such as `Billing_Rule.Default.md-meta.xml`, of the type `Billing_Rule__mdt`. It
 * names its type only in its name, and each field it gives a value in an element `values`. What a value names
 * depends on its field, which a file of the type defines: an object or a field where the field is a relationship
 * to the definition of one, a record of another type where it is a relationship to that type, and maybe a field
 * where it is a text. So the reader hands over every value that can be a name, with all values of the record, and
 * `raw-references.ts` decides once every file was read.
 */
import { foldName } from '../core/keys.ts';
import { Reader, type ElementReading } from './objects.ts';
import { textOf } from './values.ts';
import { childOf, childrenOf, type XmlDocument, type XmlElement } from './xml.ts';

/**
 * What the element of a record says. `type` is the name of the custom metadata type the record is of, with its
 * suffix: `Billing_Rule__mdt`.
 */
export function readRecord(document: XmlDocument, element: XmlElement, type: string): ElementReading {
  const reader = new Reader(document);
  // The file never names its type. The reference stands at the name of the root element.
  const { line, column } = document.place(element.start + 1 + element.name.length - element.local.length);
  reader.references.push({ form: 'object', at: { name: type, line, column }, via: 'record-of' });
  // The value of each field of the record, by the folded name of the field. It is filled while the values are
  // read, and every value of the record holds it, so that each can be resolved with all the others.
  const record = new Map<string, string>();
  for (const one of childrenOf(element, 'values')) {
    // A field without a value gives nothing. Salesforce writes an element for each field a record leaves out, and
    // the public codebases hold such elements with a value that is nil. They are no reference.
    const value = childOf(one, 'value');
    const text = textOf(value);
    if (text === null) continue;
    const field = reader.nameAt(childOf(one, 'field'));
    if (field === null) continue;
    reader.references.push({ form: 'path', start: type, names: [field], kind: 'references', via: 'listed-field' });
    if (!record.has(foldName(field.name))) record.set(foldName(field.name), text);
    const names = reader.namesIn(value);
    if (names !== null) {
      reader.references.push({ form: 'record-value', start: type, field: field.name, names, record, via: 'value' });
    }
  }
  return { attrs: {}, facts: null, references: reader.references, unread: reader.unread, formulas: [], values: record };
}
