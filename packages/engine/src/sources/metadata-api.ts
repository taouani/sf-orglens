/**
 * The four requests to the Metadata API that reading an org takes: which
 * types the org has, which components of a type, start a retrieve, and how
 * far a retrieve is.
 *
 * Every request has a time limit and follows no redirect. The session is
 * sent to the address that issued it and to no other: an answer that
 * points elsewhere is a failure, not a place to go.
 *
 * Nothing here reads records. The Metadata API has no request that could.
 */
import type { Connection } from '@salesforce/core';
import { loadSoap } from './library.ts';
import { isFailedRenewal, networkCode, saidBy } from './org-errors.ts';

/** A metadata type, as the org describes it. */
export interface DescribedType {
  /** Such as `CustomObject`. */
  readonly name: string;
  /** True for a type whose components lie in folders, such as `Report`. */
  readonly inFolder: boolean;
  /** The types of the parts of a component of this type, such as `CustomField`. */
  readonly children: readonly string[];
}

/** One component, as the org lists it. */
export interface ListedComponent {
  readonly type: string;
  readonly fullName: string;
  readonly id: string | null;
  /** As the org states it. */
  readonly lastModifiedAt: string | null;
  readonly namespacePrefix: string | null;
  readonly manageableState: string | null;
}

/** A component to retrieve: a type and a full name, never a wildcard. */
export interface Member {
  readonly type: string;
  readonly fullName: string;
}

/** How far a retrieve is. */
export interface RetrieveState {
  readonly done: boolean;
  /** As Salesforce names it: `Pending`, `InProgress`, `Succeeded`, `Failed`. */
  readonly status: string;
  readonly succeeded: boolean;
  /** For a retrieve that failed: the code and the words of Salesforce. The words are safe to show. */
  readonly errorCode: string | null;
  readonly errorMessage: string | null;
  /** What Salesforce says about members it did not hand out. */
  readonly problems: readonly string[];
  /** The zip file, if it was asked for and the retrieve succeeded. */
  readonly zip: Uint8Array | null;
}

/**
 * Why a request to the Metadata API failed.
 *
 * - `unreachable`: no answer came. `code` is the code of the network failure.
 * - `session`: the org does not accept the session, and it could not be renewed.
 * - `refused`: the org answered and said no. `code` is its code, such as `INVALID_TYPE`, and the message is
 *   what it said, without the code.
 */
export class MetadataRequestError extends Error {
  readonly kind: 'unreachable' | 'session' | 'refused';
  readonly code: string | null;

  constructor(kind: MetadataRequestError['kind'], code: string | null, message: string, cause?: unknown) {
    super(message, cause === undefined ? undefined : { cause });
    this.name = 'MetadataRequestError';
    this.kind = kind;
    this.code = code;
  }
}

export interface MetadataApi {
  /** The version every request is made with, such as `66.0`. */
  readonly apiVersion: string;
  describe(): Promise<DescribedType[]>;
  /** The components of a type. With a folder: the components of the type in that folder. */
  list(type: string, folder?: string): Promise<ListedComponent[]>;
  /** Starts a retrieve of the members and returns the id of the job. */
  startRetrieve(members: readonly Member[]): Promise<string>;
  retrieveState(jobId: string, withZip: boolean): Promise<RetrieveState>;
}

export interface MetadataApiLimits {
  /** The time limit of a request, in milliseconds. */
  readonly requestMs: number;
  /** The time limit of the request that fetches the zip file of a retrieve. */
  readonly zipMs: number;
  /** How often a request that got no answer is made again. */
  readonly repeats: number;
  /** The pause before a request is made again, in milliseconds. It doubles each time. */
  readonly repeatAfterMs: number;
}

export const DEFAULT_LIMITS: MetadataApiLimits = {
  requestMs: 60_000,
  zipMs: 600_000,
  repeats: 2,
  repeatAfterMs: 1_000,
};

const NAMESPACE = 'http://soap.sforce.com/2006/04/metadata';

const text = (value: unknown): string | null => (typeof value === 'string' && value !== '' ? value : null);
const flag = (value: unknown): boolean => value === true || value === 'true';
const list = (value: unknown): unknown[] =>
  Array.isArray(value) ? value : value === undefined || value === null ? [] : [value];
const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The code of a fault, without the prefix Salesforce puts before it (`sf:INVALID_TYPE`). */
function faultCode(thrown: unknown): string | null {
  const code = (thrown as { errorCode?: unknown } | null)?.errorCode;
  if (typeof code !== 'string') return null;
  const bare = code.slice(code.lastIndexOf(':') + 1);
  return /^[A-Z][A-Z0-9_]*$/.test(bare) ? bare : null;
}

/** The Metadata API of the org a connection is logged in to, at one API version. */
export async function metadataApi(
  connection: Connection,
  apiVersion: string,
  limits: MetadataApiLimits = DEFAULT_LIMITS,
): Promise<MetadataApi> {
  const { SOAP, ApiSchemas } = await loadSoap();
  const endpointUrl = `${connection.instanceUrl}/services/Soap/m/${apiVersion}`;

  /** Sends one request, once. */
  const send = async (method: string, message: object, schema: unknown, timeout: number): Promise<unknown> => {
    // An object, because the answer is seen in a function that is called later.
    const seen = { redirect: false };
    try {
      // The options beyond the address reach the HTTP client as they are. The class does not declare them.
      const options = { xmlns: NAMESPACE, endpointUrl, timeout, followRedirect: false };
      const endpoint = new SOAP(connection, options);
      endpoint.on('response', (response: { statusCode?: number }) => {
        const status = response.statusCode ?? 0;
        if (status >= 300 && status < 400) seen.redirect = true;
      });
      const answer = (await endpoint.invoke(method, message, { result: schema } as never, ApiSchemas)) as {
        result?: unknown;
      } | null;
      if (seen.redirect) throw new MetadataRequestError('refused', 'REDIRECT', 'The org answered with a redirect.');
      return answer?.result;
    } catch (error) {
      if (error instanceof MetadataRequestError) throw error;
      if (seen.redirect)
        throw new MetadataRequestError('refused', 'REDIRECT', 'The org answered with a redirect.', error);
      const network = networkCode(error);
      if (network !== null) {
        throw new MetadataRequestError(
          'unreachable',
          network,
          network === 'TIMEOUT' ? 'The org did not answer in time.' : `The org could not be reached (${network}).`,
          error,
        );
      }
      const code = faultCode(error);
      if (code === 'INVALID_SESSION_ID' || isFailedRenewal(error)) {
        throw new MetadataRequestError('session', code, 'The org does not accept the session.', error);
      }
      // Salesforce begins the sentence of a fault with its code. The code has a field of its own here.
      const said = saidBy(error);
      const words = code !== null && said.startsWith(`${code}:`) ? said.slice(code.length + 1).trimStart() : said;
      throw new MetadataRequestError('refused', code, words, error);
    }
  };

  /** Sends one request, and again if no answer came. */
  const call = async (
    method: string,
    message: object,
    schema: unknown,
    timeout = limits.requestMs,
  ): Promise<unknown> => {
    for (let attempt = 0; ; attempt += 1) {
      try {
        return await send(method, message, schema, timeout);
      } catch (error) {
        const again = error instanceof MetadataRequestError && error.kind === 'unreachable' && attempt < limits.repeats;
        if (!again) throw error;
        await pause(limits.repeatAfterMs * 2 ** attempt);
      }
    }
  };

  return {
    apiVersion,

    describe: async () => {
      const result = (await call(
        'describeMetadata',
        { asOfVersion: apiVersion },
        ApiSchemas.DescribeMetadataResult,
      )) as {
        metadataObjects?: unknown;
      } | null;
      return list(result?.metadataObjects).flatMap((one) => {
        const { xmlName, inFolder, childXmlNames } = one as Record<string, unknown>;
        if (typeof xmlName !== 'string' || xmlName === '') return [];
        return [
          {
            name: xmlName,
            inFolder: flag(inFolder),
            children: list(childXmlNames).filter((child): child is string => typeof child === 'string' && child !== ''),
          },
        ];
      });
    },

    list: async (type, folder) => {
      const query = folder === undefined ? { type } : { type, folder };
      const result = await call('listMetadata', { queries: [query], asOfVersion: apiVersion }, [
        ApiSchemas.FileProperties,
      ]);
      return list(result).flatMap((one) => {
        const item = one as Record<string, unknown>;
        const fullName = text(item['fullName']);
        if (fullName === null) return [];
        return [
          {
            // Filed under the type that was asked for, whatever type the org writes beside the name.
            type,
            fullName,
            id: text(item['id']),
            lastModifiedAt: text(item['lastModifiedDate']),
            namespacePrefix: text(item['namespacePrefix']),
            manageableState: text(item['manageableState']),
          },
        ];
      });
    },

    startRetrieve: async (members) => {
      const byType = new Map<string, string[]>();
      for (const { type, fullName } of members) {
        const names = byType.get(type);
        if (names === undefined) byType.set(type, [fullName]);
        else names.push(fullName);
      }
      const request = {
        apiVersion,
        unpackaged: {
          types: [...byType].map(([name, names]) => ({ members: names, name })),
          version: apiVersion,
        },
      };
      const result = (await call('retrieve', { request }, ApiSchemas.RetrieveResult)) as { id?: unknown } | null;
      const id = text(result?.id);
      if (id === null)
        throw new MetadataRequestError('refused', null, 'The org started a retrieve and gave no id for it.');
      return id;
    },

    retrieveState: async (jobId, withZip) => {
      const result = ((await call(
        'checkRetrieveStatus',
        { asyncProcessId: jobId, includeZip: withZip },
        ApiSchemas.RetrieveResult,
        withZip ? limits.zipMs : limits.requestMs,
      )) ?? {}) as Record<string, unknown>;
      const zip = text(result['zipFile']);
      const errorMessage = text(result['errorMessage']);
      return {
        done: flag(result['done']),
        status: text(result['status']) ?? '',
        succeeded: flag(result['success']),
        errorCode: text(result['errorStatusCode']),
        errorMessage: errorMessage === null ? null : saidBy(errorMessage),
        problems: list(result['messages']).flatMap((one) => {
          const problem = text((one as Record<string, unknown> | null)?.['problem']);
          return problem === null ? [] : [problem];
        }),
        zip: zip === null ? null : Buffer.from(zip, 'base64'),
      };
    },
  };
}
