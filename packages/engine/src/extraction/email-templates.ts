/**
 * What an email template says (decision record 0077): the names in its merge fields. They stand in its subject,
 * in the text version of its body that the file of its metadata holds, and in its body. Salesforce keeps the body
 * in a file of its own, `Name.email`, which is no XML, beside `Name.email-meta.xml`.
 *
 * A template writes its merge fields in the way of its kind, and its first name means what that kind says:
 *
 * - A classic template, of the type `text`, `html` or `custom`, writes `{!Contact.FirstName}`. The first name is
 *   an object, and the names after it are a field of it. `User` is the user who sends the email, and so is
 *   `Sending_User`, `Receiving_User` the user who gets it, and `Organization` the org. `{!Contact.Link}` is the
 *   link to the record, and no field.
 * - A Lightning template (`uiType` `SFX`) writes `{{{Recipient.FirstName}}}`. `Recipient` is a contact, a lead or a
 *   user, and nothing says which: its fields are not followed. `Sender` is a user and `Organization` the org. The
 *   related record is of the object `relatedEntityType` names, and is written with that name.
 * - A Visualforce template (type `visualforce`) writes `{!relatedTo.Name}` and `{!recipient.Name}`. The objects
 *   are the attributes `relatedToType` and `recipientType` of its markup. Where one is missing, nothing says
 *   which object the record is of.
 *
 * A first name that starts with `$` and that the kind does not know is read as a global variable, as in a flow.
 * Any other first name is not read, and a warning says so.
 *
 * Only the reading is done here. The names are resolved against the model of all objects, which exists only
 * once every file was read (`raw-references.ts`).
 */
import { foldName } from '../core/keys.ts';
import type { MergeStart } from './formula-names.ts';
import type { MergeForm } from './merge-fields.ts';
import { readMergeFields, type MergeFieldsReading, type StartOf } from './names-in-text.ts';
import type { ElementReading } from './objects.ts';
import type { RawReference } from './raw-references.ts';
import { placesIn, placesInText, textOf, valueOf } from './values.ts';
import { childOf, type TextDocument, type XmlDocument } from './xml.ts';

/** The elements of the file of the metadata that hold a text with merge fields. */
const TEXTS = ['subject', 'textOnly'] as const;

/** The first names of a classic template that are no object, by folded name, and the object each stands for. */
const CLASSIC_STARTS: ReadonlyMap<string, string> = new Map([
  ['organization', 'Organization'],
  ['user', 'User'],
  ['sending_user', 'User'],
  ['receiving_user', 'User'],
]);

/** A record of which nothing says the object. */
const NOT_KNOWN: MergeStart = { object: null, notKnown: 'record' };

/** A name of an object, as an attribute of the markup of a Visualforce template holds it. */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The value of an attribute of the opening tag of a Visualforce email template. `null` where it has none. */
function attributeOfMarkup(markup: string, attribute: string): string | null {
  const tag = /<messaging:emailTemplate\b[^>]*>/i.exec(markup)?.[0] ?? '';
  const value = new RegExp(String.raw`\b${attribute}\s*=\s*(["'])([^"']*)\1`, 'i').exec(tag)?.[2]?.trim();
  return value !== undefined && NAME.test(value) ? value : null;
}

/** How a template writes its merge fields, and what their first names are. */
interface Kind {
  readonly form: MergeForm;
  readonly startOf: StartOf;
  /** True for a classic template, which names the link to a record as the field `Link` of its object. */
  readonly links?: true;
}

/** True for the link to a record that a classic template names as a field of its object: `{!Contact.Link}`. */
const isLink = (reference: RawReference): boolean =>
  reference.form === 'path' && reference.names.length === 1 && foldName(reference.names[0]?.name ?? '') === 'link';

/** The kind of a template, from what the file of its metadata says and from the markup of its body. */
function kindOf(meta: XmlDocument, bodies: readonly TextDocument[]): Kind {
  const type = foldName(textOf(childOf(meta.root, 'type')) ?? '');
  const uiType = foldName(textOf(childOf(meta.root, 'uiType')) ?? '');
  if (uiType === 'sfx' || uiType === 'sfx_sample') {
    const related = textOf(childOf(meta.root, 'relatedEntityType'));
    const ofRelated = related !== null && NAME.test(related) ? related : null;
    return {
      form: 'lightning',
      startOf: (first) => {
        const folded = foldName(first);
        if (folded === 'recipient') return NOT_KNOWN;
        if (folded === 'sender') return { object: 'User' };
        if (folded === 'organization') return { object: 'Organization' };
        return ofRelated !== null && folded === foldName(ofRelated) ? { object: ofRelated } : undefined;
      },
    };
  }
  if (type === 'visualforce') {
    const markup = bodies.map((body) => body.text).join('\n');
    const starts = new Map<string, MergeStart>();
    for (const [first, attribute] of [
      ['relatedto', 'relatedToType'],
      ['recipient', 'recipientType'],
    ] as const) {
      const object = attributeOfMarkup(markup, attribute);
      starts.set(first, object === null ? NOT_KNOWN : { object });
    }
    return { form: 'classic', startOf: (first) => starts.get(foldName(first)) };
  }
  return {
    form: 'classic',
    startOf: (first) => (first.startsWith('$') ? undefined : { object: CLASSIC_STARTS.get(foldName(first)) ?? first }),
    links: true,
  };
}

/**
 * Reads an email template: the file of its metadata, and the files of its body, each as text. Gives a reading of
 * each, in the same order.
 */
export function readEmailTemplate(
  meta: XmlDocument,
  bodies: readonly TextDocument[],
): { readonly meta: ElementReading; readonly bodies: readonly ElementReading[] } {
  const { form, startOf, links } = kindOf(meta, bodies);
  const reading = (texts: MergeFieldsReading[]): ElementReading => ({
    attrs: {},
    facts: null,
    references: [],
    unread: [],
    formulas: [],
    texts:
      links === undefined
        ? texts
        : texts.map((text) => ({ ...text, references: text.references.filter((one) => !isLink(one)) })),
  });
  const texts: MergeFieldsReading[] = [];
  for (const local of TEXTS) {
    const element = childOf(meta.root, local);
    const value = valueOf(element);
    if (value === null) continue;
    texts.push(readMergeFields(value.value, startOf, local, placesIn(meta, value), undefined, form));
  }
  // The body is no XML, so a merge field in it stands in no element.
  const ofBodies = bodies.map((body) =>
    reading([readMergeFields(body.text, startOf, '', placesInText(body), undefined, form)]),
  );
  return { meta: reading(texts), bodies: ofBodies };
}
