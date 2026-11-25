/**
 * What an email template says (decision record 0077): the names in its merge fields, the objects it is written
 * for, its letterhead and the documents it attaches. The merge fields stand in its subject, in the text version of
 * its body that the file of its metadata holds, and in its body. Salesforce keeps the body in a file of its own,
 * `Name.email`, which is no XML, beside `Name.email-meta.xml`.
 *
 * A template writes its merge fields in the way of its kind, and its first name means what that kind says:
 *
 * - A classic template, of the type `text`, `html` or `custom`, writes `{!Contact.FirstName}`. The first name is
 *   an object, and the names after it are a field of it. `User` is the user who sends the email, and so is
 *   `Sending_User`, `Receiving_User` the user who gets it, and `Organization` the org. `ApprovalRequest` is the
 *   request of an approval, which is no record. `{!Contact.Link}` is the link to the record, and no field. A
 *   lookup field of Salesforce is named by its relationship, `{!Case.Owner}`, and the owner's name, address and
 *   the like as fields of the record: `{!Case.OwnerEmail}` is of the field `OwnerId`.
 * - A Lightning template (`uiType` `SFX`, or `SFX_Sample` for one that Salesforce provides) writes
 *   `{{{Recipient.FirstName}}}`, and one made before Winter '19 `{!Recipient.FirstName}`. `Recipient` is a
 *   contact, a lead or a user, and nothing says which: its fields are not followed. `Sender` is a user and
 *   `Organization` the org. The related record is of the object `relatedEntityType` names, and is written with
 *   that name.
 * - A Visualforce template (type `visualforce`) writes `{!relatedTo.Name}` and `{!recipient.Name}`. The objects
 *   are the attributes `relatedToType` and `recipientType` of its markup. Where one is missing, nothing says
 *   which object the record is of. `{!relatedTo.Lines__r}` is a child relationship of the record.
 *
 * A merge field of the form `{!...}` that holds more than a name, such as `{!IF(ISBLANK(Case.Reason), ...)}`, is
 * read as a formula whose names start as the merge fields do. A first name that starts with `$` and that the kind
 * does not know is read as a global variable, as in a flow. Any other first name is not read, and a warning says
 * so.
 *
 * Only the reading is done here. The names are resolved against the model of all objects, which exists only
 * once every file was read (`raw-references.ts`).
 */
import { foldName } from '../core/keys.ts';
import type { MergeStart } from './formula-names.ts';
import type { MergeForm } from './merge-fields.ts';
import { standardLookupField } from './model.ts';
import { readMergeFields, type MergeFieldsReading, type StartOf } from './names-in-text.ts';
import { Reader, type ElementReading } from './objects.ts';
import type { RawReference } from './raw-references.ts';
import { placesIn, placesInText, textOf, valueOf, type NameAt } from './values.ts';
import { childOf, childrenOf, type TextDocument, type XmlDocument } from './xml.ts';

/** The elements of the file of the metadata that hold a text with merge fields. */
const TEXTS = ['subject', 'textOnly'] as const;

/** The first names of a classic template that are no object, by folded name, and what each stands for. */
const CLASSIC_STARTS: ReadonlyMap<string, MergeStart> = new Map([
  ['organization', { object: 'Organization' }],
  ['user', { object: 'User' }],
  ['sending_user', { object: 'User' }],
  ['receiving_user', { object: 'User' }],
  ['approvalrequest', { object: null }],
]);

/** A record of which nothing says the object. */
const NOT_KNOWN: MergeStart = { object: null, notKnown: 'record' };

/** A name of an object, as an attribute of the markup of a Visualforce template holds it. */
const NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The opening tag of a Visualforce email template. The value of an attribute can hold a `>`. */
const TEMPLATE_TAG = /<messaging:emailTemplate\b(?:[^>"']|"[^"]*"|'[^']*')*>/i;
/** An attribute of a tag and its value, in quotes. */
const ATTRIBUTE = /([A-Za-z_:][-A-Za-z0-9_:.]*)\s*=\s*(?:"([^"]*)"|'([^']*)')/dg;

/** The name of a field of the owner of a record that a classic template writes as a field of the record. */
const OWNER_FIELD = /^Owner[A-Z][A-Za-z0-9]*$/;

/** A child relationship of a custom object, as a Visualforce template names one: `Lines__r`. */
const CHILD_RELATIONSHIP = /__r$/i;

/** The object an attribute of the opening tag of a Visualforce template names, with its place in the body. */
function objectInMarkup(body: TextDocument, attribute: string): NameAt | null {
  const tag = TEMPLATE_TAG.exec(body.text);
  if (tag === null) return null;
  for (const match of tag[0].matchAll(ATTRIBUTE)) {
    if (foldName(match[1] ?? '') !== foldName(attribute)) continue;
    const span = match.indices?.[2] ?? match.indices?.[3];
    const raw = match[2] ?? match[3] ?? '';
    const value = raw.trim();
    if (span === undefined || !NAME.test(value)) return null;
    const from = tag.index + span[0] + raw.indexOf(value);
    return placesInText(body)(from, from + value.length);
  }
  return null;
}

/** How a template writes its merge fields, what their first names are, and what else its kind names. */
interface Kind {
  /** The forms of merge fields its texts hold. A merge field of the form `{!...}` can hold a formula. */
  readonly forms: readonly MergeForm[];
  readonly startOf: StartOf;
  /** What a reference of a merge field is in this kind: the same, another one, or none. */
  readonly adjust: (reference: RawReference) => RawReference | null;
  /** The objects the markup of its body names, by the index of the body. */
  readonly objects: readonly { readonly body: number; readonly at: NameAt }[];
}

/** The last name of a path of one name or more, where the path is a reference of that form. */
const lastOf = (reference: RawReference): (NameAt & { resolveAs?: string }) | null =>
  reference.form === 'path' ? (reference.names.at(-1) ?? null) : null;

/** No reference for the link to a record that a template names as a field of its object: `{!Contact.Link}`. */
const withoutLink = (reference: RawReference): RawReference | null =>
  reference.form === 'path' && reference.names.length === 1 && foldName(lastOf(reference)?.name ?? '') === 'link'
    ? null
    : reference;

/**
 * A reference of a classic template, where its last name is a lookup field of Salesforce named by its
 * relationship, or a field of the owner: the reference goes to the lookup field.
 */
function classicAdjusted(reference: RawReference): RawReference | null {
  const kept = withoutLink(reference);
  const last = kept === null ? null : lastOf(kept);
  if (kept?.form !== 'path' || last === null || last.resolveAs !== undefined) return kept;
  const field =
    standardLookupField(last.name) ??
    (OWNER_FIELD.test(last.name) && foldName(last.name) !== 'ownerid' ? 'OwnerId' : undefined);
  if (field === undefined) return kept;
  return { ...kept, names: [...kept.names.slice(0, -1), { ...last, resolveAs: field }] };
}

/** A reference of a Visualforce template, where it names a child relationship of the record: a join. */
function visualforceAdjusted(reference: RawReference): RawReference | null {
  const last = lastOf(reference);
  if (
    reference.form !== 'path' ||
    reference.names.length !== 1 ||
    last === null ||
    !CHILD_RELATIONSHIP.test(last.name)
  ) {
    return reference;
  }
  const { line, column, name } = last;
  return { form: 'join', start: reference.start, joins: [], at: { name, line, column }, via: reference.via };
}

/** The kind of a template, from what the file of its metadata says and from the markup of its body. */
function kindOf(meta: XmlDocument, bodies: readonly TextDocument[]): Kind {
  const type = foldName(textOf(childOf(meta.root, 'type')) ?? '');
  const uiType = foldName(textOf(childOf(meta.root, 'uiType')) ?? '');
  if (uiType === 'sfx' || uiType === 'sfx_sample') {
    const related = textOf(childOf(meta.root, 'relatedEntityType'));
    const ofRelated = related !== null && NAME.test(related) ? related : null;
    return {
      forms: ['lightning', 'classic'],
      startOf: (first) => {
        const folded = foldName(first);
        if (folded === 'recipient') return NOT_KNOWN;
        if (folded === 'sender') return { object: 'User' };
        if (folded === 'organization') return { object: 'Organization' };
        return ofRelated !== null && folded === foldName(ofRelated) ? { object: ofRelated } : undefined;
      },
      adjust: withoutLink,
      objects: [],
    };
  }
  if (type === 'visualforce') {
    const starts = new Map<string, MergeStart>();
    const objects: { body: number; at: NameAt }[] = [];
    // The body whose markup opens the template.
    const index = bodies.findIndex((body) => TEMPLATE_TAG.test(body.text));
    const body = bodies[index];
    for (const [first, attribute] of [
      ['relatedto', 'relatedToType'],
      ['recipient', 'recipientType'],
    ] as const) {
      const at = body === undefined ? null : objectInMarkup(body, attribute);
      if (at !== null) objects.push({ body: index, at });
      starts.set(first, at === null ? NOT_KNOWN : { object: at.name });
    }
    return {
      forms: ['classic'],
      startOf: (first) => starts.get(foldName(first)),
      adjust: visualforceAdjusted,
      objects,
    };
  }
  return {
    forms: ['classic'],
    startOf: (first) =>
      first.startsWith('$') ? undefined : (CLASSIC_STARTS.get(foldName(first)) ?? { object: first }),
    adjust: classicAdjusted,
    objects: [],
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
  const { forms, startOf, adjust, objects } = kindOf(meta, bodies);
  /** The merge fields of a text, in each form the kind writes them. */
  const mergeFields = (text: string, element: string, at: ReturnType<typeof placesInText>): MergeFieldsReading[] =>
    forms.map((form) => {
      const read = readMergeFields(
        text,
        startOf,
        element,
        at,
        undefined,
        form,
        form === 'classic' ? 'formula' : undefined,
      );
      return { ...read, references: read.references.flatMap((one) => adjust(one) ?? []) };
    });

  // What the file of the metadata names: the object of a Lightning template, its letterhead and its documents.
  const reader = new Reader(meta);
  if (forms.includes('lightning')) {
    reader.name(childOf(meta.root, 'relatedEntityType'), (at) => ({ form: 'object', at, via: 'object' }));
  }
  reader.name(childOf(meta.root, 'letterhead'), (at) => ({
    form: 'component',
    type: 'Letterhead',
    at,
    via: 'template',
  }));
  for (const document of childrenOf(meta.root, 'attachedDocuments')) {
    reader.wholeName(document, (at) => ({
      form: 'component',
      type: 'Document',
      at,
      fullName: at.name,
      via: 'attachment',
    }));
  }
  const texts: MergeFieldsReading[] = [];
  for (const local of TEXTS) {
    const value = valueOf(childOf(meta.root, local));
    if (value !== null) texts.push(...mergeFields(value.value, local, placesIn(meta, value)));
  }
  const ofMeta: ElementReading = {
    attrs: {},
    facts: null,
    references: reader.references,
    unread: reader.unread,
    formulas: [],
    texts,
  };

  // The body is no XML, so a merge field in it stands in no element.
  const ofBodies = bodies.map((body, index): ElementReading => ({
    attrs: {},
    facts: null,
    references: objects.filter((one) => one.body === index).map(({ at }) => ({ form: 'object', at, via: 'object' })),
    unread: [],
    formulas: [],
    texts: mergeFields(body.text, '', placesInText(body)),
  }));
  return { meta: ofMeta, bodies: ofBodies };
}
