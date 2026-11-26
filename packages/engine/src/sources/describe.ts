/**
 * The descriptions of the objects of an org, read through its REST API (decision record 0085).
 *
 * A description says what an object holds: its fields, the type of each, the objects a lookup points at, the names
 * of relationships and the child relationships. It holds no value of a record. It follows the permissions of the
 * user who logs in: a field that user cannot see is left out of it.
 *
 * One request is made for each object, `GET /services/data/v<version>/sobjects/<object>/describe`, a few at a time.
 * Of an answer only what the resolver of Apex reads is kept; labels, help texts and the values of picklists are
 * dropped here. A failure of the org never throws: the reading says how far it came. Only a fault of this machine
 * or of the code is thrown.
 */
import { isAboutTheOrg } from './metadata-api.ts';
import type { OrgSession } from './org.ts';
import { MetadataRequestError, openOrgHttp, repeated, requestFailure, type RequestLimits } from './org-http.ts';

/** A field as a description gives it. */
export interface DescribedField {
  /** The name of the field, as the org writes it: `Amount__c`, `AccountId`. */
  readonly name: string;
  /** The type of the field in the REST API: `reference`, `string`, `picklist`, `currency` and so on. */
  readonly type: string;
  /** The objects a lookup points at. Empty for a field that is no lookup. More than one for a polymorphic one. */
  readonly referenceTo: readonly string[];
  /** The name of the relationship of a lookup: `Account` of `AccountId`, `Invoice__r` of `Invoice__c`. */
  readonly relationshipName: string | null;
}

/** A child relationship as a description gives it: `Contacts` of `Account`, whose records are of `Contact`. */
export interface DescribedChild {
  readonly relationshipName: string;
  /** The object of the records the relationship leads to. */
  readonly childSObject: string;
  /** The lookup field of that object that points back. */
  readonly field: string;
}

/** What is kept of the description of one object. */
export interface ObjectDescription {
  /** The name of the object, as the org writes it. */
  readonly name: string;
  /** Sorted by name. */
  readonly fields: readonly DescribedField[];
  /** Those with a name, sorted by it. */
  readonly childRelationships: readonly DescribedChild[];
}

/** What was read of the descriptions of the objects of an org. */
export interface DescriptionReading {
  /** In the order of the names that were asked for. */
  readonly descriptions: readonly ObjectDescription[];
  /**
   * - `whole`: every object that was asked for is described.
   * - `partial`: some are not: the org did not know them (`unknown`), or did not answer for them (`failed`).
   * - `none`: objects were asked for, and none is described.
   */
  readonly state: 'whole' | 'partial' | 'none';
  /** Requests that were sent, with those sent again. */
  readonly requests: number;
  /** The objects the org says it does not know, in the order they were asked for. */
  readonly unknown: readonly string[];
  /** The objects for which no description came, for another reason, in the order they were asked for. */
  readonly failed: readonly string[];
  /** The code of the first failure, or `null`. */
  readonly code: string | null;
}

export interface DescribeLimits extends RequestLimits {
  /** How many requests are under way at once. */
  readonly parallel: number;
}

const DEFAULT_DESCRIBE_LIMITS: DescribeLimits = { requestMs: 60_000, repeats: 2, repeatAfterMs: 1_000, parallel: 4 };

/** The limits a reading keeps to: the defaults, and what `limits` changes of them. */
export function describeLimits(limits: Partial<DescribeLimits> = {}): DescribeLimits {
  return { ...DEFAULT_DESCRIBE_LIMITS, ...limits };
}

export interface DescribeOptions {
  readonly limits?: Partial<DescribeLimits> | undefined;
  /** The version of the API to ask, such as `66.0`. Default: the one of the session. */
  readonly apiVersion?: string | undefined;
  /** Called after every object, with how many were asked for and are done. */
  readonly onProgress?: ((done: number, total: number) => void) | undefined;
}

/** The name of an object that can stand in the address of a request. */
const OBJECT_NAME = /^[A-Za-z][A-Za-z0-9_]*$/;

/** The address of the description of an object. A test holds every address the engine asks for against this. */
export const describeAddress = (apiVersion: string, object: string): string =>
  `/services/data/v${apiVersion}/sobjects/${object}/describe`;

const isText = (value: unknown): value is string => typeof value === 'string' && value !== '';
const byName = (a: { readonly name: string }, b: { readonly name: string }): number =>
  a.name < b.name ? -1 : a.name > b.name ? 1 : 0;

/**
 * What is kept of an answer to the request for `object`, or `null` for an answer that is not a description of it.
 * The org writes the name of an object as it knows it, which can differ from the name asked for in its capitals only.
 */
function kept(answer: unknown, object: string): ObjectDescription | null {
  if (typeof answer !== 'object' || answer === null) return null;
  const { name, fields, childRelationships } = answer as Record<string, unknown>;
  if (!isText(name) || !Array.isArray(fields)) return null;
  if (name.toLowerCase() !== object.toLowerCase()) return null;
  const described: DescribedField[] = [];
  for (const field of fields as unknown[]) {
    if (typeof field !== 'object' || field === null) return null;
    const one = field as Record<string, unknown>;
    if (!isText(one['name']) || !isText(one['type'])) return null;
    const referenceTo = Array.isArray(one['referenceTo']) ? (one['referenceTo'] as unknown[]).filter(isText) : [];
    const relationshipName = isText(one['relationshipName']) ? one['relationshipName'] : null;
    described.push({ name: one['name'], type: one['type'], referenceTo: [...referenceTo].sort(), relationshipName });
  }
  const children: DescribedChild[] = [];
  for (const child of Array.isArray(childRelationships) ? (childRelationships as unknown[]) : []) {
    if (typeof child !== 'object' || child === null) continue;
    const one = child as Record<string, unknown>;
    // A child relationship without a name cannot be written in Apex.
    if (!isText(one['relationshipName']) || !isText(one['childSObject']) || !isText(one['field'])) continue;
    children.push({
      relationshipName: one['relationshipName'],
      childSObject: one['childSObject'],
      field: one['field'],
    });
  }
  return {
    name,
    fields: described.sort(byName),
    childRelationships: children.sort((a, b) => byName({ name: a.relationshipName }, { name: b.relationshipName })),
  };
}

/**
 * Asks the org for the description of each object of `objects`.
 *
 * Never fails because of the org. An object the org does not know is `unknown`. After a failure that would hold
 * for every request (no answer in time, after the repetitions, a session the org does not accept, or a refusal that
 * holds for the org, such as a used-up limit of requests) no further request is made, also no repetition of a
 * request that is under way, and the objects that are left are `failed`.
 */
export async function describeObjects(
  session: OrgSession,
  objects: readonly string[],
  options: DescribeOptions = {},
): Promise<DescriptionReading> {
  const limits = describeLimits(options.limits);
  const apiVersion = options.apiVersion ?? session.apiVersion;
  const results = new Map<string, ObjectDescription | 'unknown' | 'failed'>();
  let requests = 0;
  let code: string | null = null;
  let stopped = false;
  let done = 0;
  const asked = [...new Set(objects)];
  if (asked.length === 0) return { descriptions: [], state: 'whole', requests, unknown: [], failed: [], code };

  const http = await openOrgHttp();
  const fail = (object: string, failure: MetadataRequestError): void => {
    code ??= failure.code ?? 'NO_CODE';
    results.set(object, 'failed');
    if (failure.kind !== 'refused' || isAboutTheOrg(failure)) stopped = true;
  };
  const describeOne = async (object: string): Promise<void> => {
    if (stopped) {
      results.set(object, 'failed');
      return;
    }
    if (!OBJECT_NAME.test(object)) {
      fail(object, new MetadataRequestError('refused', 'INVALID_NAME', 'The name cannot be one of an object.'));
      return;
    }
    try {
      const answer = await repeated(http, limits, async () => {
        // A repetition of a request that was under way when the reading stopped is not sent.
        if (stopped) throw new MetadataRequestError('refused', 'STOPPED', 'The reading of the descriptions stopped.');
        requests += 1;
        try {
          // What sends the request is an option the declaration of the client does not name.
          const sent = { transport: http.transport(limits.requestMs) } as never;
          return await session.connection.request(describeAddress(apiVersion, object), sent);
        } catch (error) {
          throw requestFailure(error);
        }
      });
      const description = kept(answer, object);
      if (description === null) {
        fail(object, new MetadataRequestError('refused', 'NOT_A_DESCRIPTION', 'The answer is not a description.'));
      } else {
        results.set(object, description);
      }
    } catch (error) {
      if (!(error instanceof MetadataRequestError)) throw error;
      if (error.code === 'NOT_FOUND') results.set(object, 'unknown');
      else fail(object, error);
    }
  };

  try {
    const queue = [...asked];
    const worker = async (): Promise<void> => {
      for (let object = queue.shift(); object !== undefined; object = queue.shift()) {
        await describeOne(object);
        done += 1;
        options.onProgress?.(done, asked.length);
      }
    };
    await Promise.all(Array.from({ length: Math.max(1, limits.parallel) }, worker));
  } finally {
    await http.close();
  }

  const descriptions = asked.flatMap((object) => {
    const result = results.get(object);
    return typeof result === 'object' ? [result] : [];
  });
  const unknown = asked.filter((object) => results.get(object) === 'unknown');
  const failed = asked.filter((object) => results.get(object) === 'failed');
  const state = descriptions.length === asked.length ? 'whole' : descriptions.length === 0 ? 'none' : 'partial';
  return { descriptions, state, requests, unknown, failed, code };
}
