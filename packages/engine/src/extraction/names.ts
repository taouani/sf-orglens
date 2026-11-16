/**
 * What the name of a component says about where it comes from.
 *
 * Salesforce writes a name that somebody gave with two underscores: a custom object or field ends with a suffix
 * (`Invoice__c`, `Billing_Rule__mdt`), and a component of a package starts with the namespace of the package
 * (`npsp__Batch__c`, `npsp__Region`). A name Salesforce gave has no two underscores in a row.
 */

const SEPARATOR = '__';
/** The two parts of a geolocation field: `Place__Latitude__s` is a part of the field `Place__c`. */
const GEOLOCATION_PART = /^(.+)__(?:latitude|longitude)__s$/i;

/** True if the name of an object or a field is a custom one: it ends with two underscores and a suffix. */
export function isCustomName(name: string): boolean {
  return name.includes(SEPARATOR);
}

/**
 * The namespace prefix of the name of an object or a field, or `null` if it has none. Such a name ends with a
 * suffix, so a prefix is there when the name has three parts.
 */
export function namespaceOf(name: string): string | null {
  const whole = GEOLOCATION_PART.exec(name)?.[1];
  const parts = (whole === undefined ? name : `${whole}__c`).split(SEPARATOR);
  return parts.length >= 3 && parts[0] !== undefined && parts[0] !== '' ? parts[0] : null;
}

/**
 * The namespace prefix of a name that has no suffix, such as the name of a global value set or of a custom
 * label, or `null` if it has none.
 */
export function plainNamespaceOf(name: string): string | null {
  const parts = name.split(SEPARATOR);
  return parts.length >= 2 && parts[0] !== undefined && parts[0] !== '' ? parts[0] : null;
}

/** The field a part of a geolocation field belongs to: `Place__c` for `Place__Latitude__s`. `null` for any other name. */
export function geolocationField(name: string): string | null {
  const whole = GEOLOCATION_PART.exec(name)?.[1];
  return whole === undefined ? null : `${whole}__c`;
}
