/**
 * Which warnings of the analysis of a snapshot can bear on an impact answer (decision record 0074). A warning says
 * that names of a component were not turned into references, or that a component was not read. A reference that is
 * missing that way can be missing from an answer only where the walk could have gone along it.
 *
 * For what a component refers to, that is a reference from a component the walk went from: the component, what it
 * contains, a result, or an element of a flow it found. For what refers to a component, it is a reference to a
 * component of the answer from a component the walk does not start from: what the start names is never what refers
 * to it. Of most warnings it is not known what the names could be. A `PATH_NOT_FOLLOWED` keeps them: each is a
 * field, or the relationship of a field, of an object nothing says. The path can end at the object of its last
 * relationship, and a flow can compare `RecordType.DeveloperName` at its end with the name of a record type. So
 * such a warning bears on an answer that holds an object, a field whose name the names can be, or a record type
 * where the names hold `RecordType`, and on no other, unless it kept fewer names than the path has.
 */
import type { ComponentKey } from '../core/keys.ts';
import { fieldsANameCanBe, MOST_NAMES_SHOWN } from '../extraction/raw-references.ts';
import type { AnalysisWarning } from '../store/snapshots.ts';

/** What of a walk says which warnings can bear on its answer. */
export interface WalkedFrom {
  readonly start: readonly ComponentKey[];
  readonly through: readonly ComponentKey[];
  readonly results: readonly { readonly key: ComponentKey }[];
}

const typeOf = (key: string): string => key.slice(0, key.indexOf(':'));
/** The name of a field without its object, as the key folds it: `CustomField:invoice__c.amount__c` gives `amount__c`. */
const fieldNameOf = (key: string): string => key.slice(key.lastIndexOf('.') + 1);

/** The warnings that can bear on an answer of a walk in the direction that is given, in their order. */
export function warningsThatBear<T extends AnalysisWarning>(
  warnings: readonly T[],
  walk: WalkedFrom,
  direction: 'incoming' | 'outgoing',
): T[] {
  if (warnings.length === 0) return [];
  const start = new Set<string>(walk.start);
  const held = new Set<string>([...walk.start, ...walk.through, ...walk.results.map((result) => result.key)]);
  if (direction === 'outgoing') {
    return warnings.filter((warning) => warning.componentKey === null || held.has(warning.componentKey));
  }
  const keys = [...held];
  const anObject = keys.some((key) => typeOf(key) === 'CustomObject');
  const aRecordType = keys.some((key) => typeOf(key) === 'RecordType');
  const fields = new Set(keys.filter((key) => typeOf(key) === 'CustomField').map(fieldNameOf));
  return warnings.filter((warning) => {
    if (warning.componentKey !== null && start.has(warning.componentKey)) return false;
    const names = warning.notFollowed;
    if (warning.code !== 'PATH_NOT_FOLLOWED' || names === null || names.length >= MOST_NAMES_SHOWN || anObject) {
      return true;
    }
    return names.some(
      (name) =>
        (aRecordType && fieldsANameCanBe(name).includes('recordtype')) ||
        fieldsANameCanBe(name).some((field) => fields.has(field)),
    );
  });
}
