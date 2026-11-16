/**
 * The four requests to the Metadata API that reading an org takes: which
 * types the org has, which components of a type, start a retrieve, and how
 * far a retrieve is.
 *
 * Every request has a time limit for the whole answer and follows no
 * redirect. The session is sent to the address that issued it and to no
 * other: an answer that points elsewhere is a failure, not a place to go.
 * A request is sent with the HTTP client directly, not the way the SOAP
 * client would send it (`org-http.ts`).
 *
 * One thing is not sent from here: when the session of a Salesforce CLI
 * login has expired, the Salesforce library renews it with requests of
 * its own (decision record 0031).
 *
 * Nothing here reads records. The Metadata API has no request that could.
 */
import type { Connection } from '@salesforce/core';
import { loadSoap } from './library.ts';
import { saidBy } from './org-errors.ts';
import { MetadataRequestError, openOrgHttp, repeated, requestFailure, type RequestLimits } from './org-http.ts';

export { MetadataRequestError };

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

export interface MetadataApi {
  /** The version every request is made with, such as `66.0`. */
  readonly apiVersion: string;
  describe(): Promise<DescribedType[]>;
  /** The components of a type. With a folder: the components of the type in that folder. */
  list(type: string, folder?: string): Promise<ListedComponent[]>;
  /** Starts a retrieve of the members and returns the id of the job. */
  startRetrieve(members: readonly Member[]): Promise<string>;
  retrieveState(jobId: string, withZip: boolean): Promise<RetrieveState>;
  /** Ends the connections to the org. A request that is under way fails, and no further one is made. */
  close(): Promise<void>;
}

export interface MetadataApiLimits extends RequestLimits {
  /** The time limit of the request that fetches the zip file of a retrieve. */
  readonly zipMs: number;
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

/**
 * Codes with which a request is refused for a reason that holds for the whole org, whatever was asked for: the
 * limit of requests is used up, the API is closed to the org or to the user, or the address of the org sends
 * requests elsewhere. They are taken from the list of status codes in the documentation of the API. None of them
 * was seen in the answer of a real org yet.
 */
const ABOUT_THE_ORG: ReadonlySet<string> = new Set([
  'REDIRECT',
  'REQUEST_LIMIT_EXCEEDED',
  'API_DISABLED_FOR_ORG',
  'API_CURRENTLY_DISABLED',
  'ORG_LOCKED',
  'ORG_IN_MAINTENANCE',
  'INVALID_OPERATION_WITH_EXPIRED_PASSWORD',
]);

/** True if the org refused for a reason that holds for every request, so that asking for something else is pointless. */
export function isAboutTheOrg(error: MetadataRequestError): boolean {
  return error.kind === 'refused' && error.code !== null && ABOUT_THE_ORG.has(error.code);
}

/** The Metadata API of the org a connection is logged in to, at one API version. */
export async function metadataApi(
  connection: Connection,
  apiVersion: string,
  limits: MetadataApiLimits = DEFAULT_LIMITS,
): Promise<MetadataApi> {
  const [{ SOAP, ApiSchemas }, http] = await Promise.all([loadSoap(), openOrgHttp()]);
  const endpointUrl = `${connection.instanceUrl}/services/Soap/m/${apiVersion}`;

  /** Sends one request, once. */
  const send = async (method: string, message: object, schema: unknown, timeout: number): Promise<unknown> => {
    try {
      // The class takes what sends its requests as an option. Its declaration of the options does not say so.
      const options = { xmlns: NAMESPACE, endpointUrl, transport: http.transport(timeout) };
      const endpoint = new SOAP(connection, options);
      const answer = (await endpoint.invoke(method, message, { result: schema } as never, ApiSchemas)) as {
        result?: unknown;
      } | null;
      return answer?.result;
    } catch (error) {
      throw requestFailure(error);
    }
  };

  /** Sends one request, and again if no answer came. */
  const call = (method: string, message: object, schema: unknown, timeout = limits.requestMs): Promise<unknown> =>
    repeated(http, limits, () => send(method, message, schema, timeout));

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

    close: () => http.close(),
  };
}
