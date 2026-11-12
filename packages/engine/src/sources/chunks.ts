/**
 * Plans the retrieve of an org: which components are asked for by name, and
 * in which chunks.
 *
 * Salesforce hands out at most 10,000 files and about 39 MB per retrieve,
 * and says how large a retrieve is only once it has failed. So a chunk is
 * planned well below the limits, by a weight that estimates the files of
 * each member. A chunk that fails anyway is split in two (`splitMembers`).
 *
 * Every member is named. A wildcard leaves out standard objects and
 * components of installed packages, and nothing would say so.
 */
import type { Inventory } from './inventory.ts';
import type { Member } from './metadata-api.ts';
import { byCodeUnit } from './tree.ts';

/** The weight a chunk is filled up to. One unit is about one file. */
export const DEFAULT_CHUNK_WEIGHT = 3_000;

/**
 * The estimated number of files of one component, for types that have
 * more than the usual two or that are large. These are estimates, not
 * measurements. A wrong one costs a split, not a wrong snapshot.
 */
const WEIGHT: Readonly<Record<string, number>> = {
  AuraDefinitionBundle: 8,
  LightningComponentBundle: 6,
  ExperienceBundle: 50,
  DigitalExperienceBundle: 50,
  SiteDotCom: 50,
  StaticResource: 20,
  Document: 10,
  ContentAsset: 10,
  Profile: 20,
  PermissionSet: 10,
  Flow: 4,
};
const DEFAULT_WEIGHT = 2;

const idOf = (member: Member): string => `${member.type}\n${member.fullName}`;

/**
 * The members to retrieve, sorted by type and name, each with its weight.
 *
 * - A component of a `top` type is a member.
 * - A folder is a member under the type of what it holds.
 * - A part is not a member: it comes with its parent. If the org lists a part and not its parent, the parent
 *   becomes a member. Fields of a standard object are the usual case.
 */
export function membersOf(inventory: Inventory): { member: Member; weight: number }[] {
  const roles = new Map(inventory.types.map((type) => [type.type, type]));
  const weights = new Map<string, { member: Member; weight: number }>();
  const add = (member: Member, weight: number): void => {
    const entry = weights.get(idOf(member));
    if (entry === undefined) weights.set(idOf(member), { member, weight });
    else entry.weight += weight;
  };

  const parts: { parent: Member }[] = [];
  for (const item of inventory.items) {
    const type = roles.get(item.type);
    if (type === undefined) continue;
    if (type.role === 'top') {
      add({ type: item.type, fullName: item.fullName }, WEIGHT[item.type] ?? DEFAULT_WEIGHT);
    } else if (type.role === 'folder' && type.of !== null) {
      add({ type: type.of, fullName: item.fullName }, 1);
    } else if (type.role === 'part' && type.of !== null) {
      // The name of a part starts with the name of its parent. A part without that, such as a custom label,
      // belongs to a parent the org lists by its own name.
      const dot = item.fullName.indexOf('.');
      if (dot > 0) parts.push({ parent: { type: type.of, fullName: item.fullName.slice(0, dot) } });
    }
  }
  // A parent weighs one file more for each of its parts.
  for (const { parent } of parts)
    add(parent, weights.has(idOf(parent)) ? 1 : (WEIGHT[parent.type] ?? DEFAULT_WEIGHT) + 1);

  return [...weights.values()].sort(
    (a, b) => byCodeUnit(a.member.type, b.member.type) || byCodeUnit(a.member.fullName, b.member.fullName),
  );
}

/**
 * The chunks of a retrieve: the members in order, each chunk filled up to
 * the weight. A member that weighs more than a whole chunk is one alone.
 */
export function planChunks(inventory: Inventory, chunkWeight = DEFAULT_CHUNK_WEIGHT): Member[][] {
  const chunks: Member[][] = [];
  let current: Member[] = [];
  let filled = 0;
  for (const { member, weight } of membersOf(inventory)) {
    if (current.length > 0 && filled + weight > chunkWeight) {
      chunks.push(current);
      current = [];
      filled = 0;
    }
    current.push(member);
    filled += weight;
  }
  if (current.length > 0) chunks.push(current);
  return chunks;
}

/** The two halves of the members of a chunk that failed. A chunk of one member cannot be split. */
export function splitMembers(members: readonly Member[]): [Member[], Member[]] {
  const middle = Math.ceil(members.length / 2);
  return [members.slice(0, middle), members.slice(middle)];
}
