/**
 * The four requests to the Metadata API that reading an org takes: which
 * types the org has, which components of a type, start a retrieve, and how
 * far a retrieve is.
 *
 * Every request has a time limit for the whole answer and follows no
 * redirect. The session is sent to the address that issued it and to no
 * other: an answer that points elsewhere is a failure, not a place to go.
 * A request is sent with the HTTP client directly, not the way the SOAP
 * client would send it.
 *
 * One thing is not sent from here: when the session of a Salesforce CLI
 * login has expired, the Salesforce library renews it with requests of
 * its own (decision record 0031).
 *
 * Nothing here reads records. The Metadata API has no request that could.
 */
import { PassThrough } from 'node:stream';
import type { Connection } from '@salesforce/core';
import { loadSoap, loadUndici } from './library.ts';
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
  /** Ends the connections to the org. A request that is under way fails, and no further one is made. */
  close(): Promise<void>;
}

export interface MetadataApiLimits {
  /** The time limit of a request, from sending it to the end of its answer, in milliseconds. */
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

/** One HTTP request, as the SOAP client hands it to what sends it. */
interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/**
 * The answers of a gateway before the org, and of an org that is not there for the moment. They are failures to
 * reach the org, not answers of it, and the request is made again.
 */
const NOT_THERE = /^(?:ERROR_HTTP_(?:420|429|5\d\d)|SERVER_UNAVAILABLE)$/;

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

/**
 * The proxy the Salesforce libraries use for their requests. They take the first of these variables that is set,
 * also if it is set to nothing, which stands for no proxy.
 */
function proxyOfProcess(): string | undefined {
  const { env } = process;
  const value = env['https_proxy'] ?? env['http_proxy'] ?? env['HTTPS_PROXY'] ?? env['HTTP_PROXY'];
  return value === undefined || value === '' ? undefined : value;
}

/** The Metadata API of the org a connection is logged in to, at one API version. */
export async function metadataApi(
  connection: Connection,
  apiVersion: string,
  limits: MetadataApiLimits = DEFAULT_LIMITS,
): Promise<MetadataApi> {
  const [{ SOAP, ApiSchemas }, { fetch, Agent, ProxyAgent }] = await Promise.all([loadSoap(), loadUndici()]);
  const endpointUrl = `${connection.instanceUrl}/services/Soap/m/${apiVersion}`;
  // The connections of this API. They go the way the connections of the Salesforce libraries go.
  const proxy = proxyOfProcess();
  const dispatcher =
    proxy === undefined
      ? new Agent({ connect: { allowH2: false } })
      : new ProxyAgent({ uri: proxy, requestTls: { allowH2: false } });
  let closed = false;

  /**
   * Sends one HTTP request for the SOAP client and reads the whole answer, within one time limit. The client's own
   * way of sending limits only the time until an answer starts, follows redirects, and lets a connection that
   * breaks in the middle of an answer end the process.
   */
  const transport = (timeout: number): { httpRequest: (request: HttpRequest) => unknown } => ({
    httpRequest: (request) => {
      const answer = (async () => {
        const response = await fetch(request.url, {
          method: request.method,
          ...(request.headers === undefined ? {} : { headers: { ...request.headers } }),
          ...(request.body === undefined ? {} : { body: request.body }),
          // The session is sent to the address that issued it and to no other.
          redirect: 'manual',
          signal: AbortSignal.timeout(timeout),
          dispatcher,
        });
        if (response.status >= 300 && response.status < 400) {
          await response.body?.cancel();
          throw new MetadataRequestError('refused', 'REDIRECT', 'The org answered with a redirect.');
        }
        const headers: Record<string, string> = {};
        response.headers.forEach((value, name) => {
          headers[name.toLowerCase()] = value;
        });
        return { statusCode: response.status, headers, body: await response.text() };
      })();
      // The client asks for a stream beside the answer, and reads nothing from it.
      return Object.assign(answer, { stream: () => new PassThrough() });
    },
  });

  /** Sends one request, once. */
  const send = async (method: string, message: object, schema: unknown, timeout: number): Promise<unknown> => {
    if (closed) throw new MetadataRequestError('unreachable', 'CLOSED', 'The connection to the org was closed.');
    try {
      // The class takes what sends its requests as an option. Its declaration of the options does not say so.
      const options = { xmlns: NAMESPACE, endpointUrl, transport: transport(timeout) };
      const endpoint = new SOAP(connection, options);
      const answer = (await endpoint.invoke(method, message, { result: schema } as never, ApiSchemas)) as {
        result?: unknown;
      } | null;
      return answer?.result;
    } catch (error) {
      if (error instanceof MetadataRequestError) throw error;
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
      if (code !== null && NOT_THERE.test(code)) {
        const status = code.replace('ERROR_HTTP_', 'HTTP_');
        throw new MetadataRequestError('unreachable', status, `The org could not be reached (${status}).`, error);
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
        const again =
          error instanceof MetadataRequestError && error.kind === 'unreachable' && attempt < limits.repeats && !closed;
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

    close: async () => {
      closed = true;
      await dispatcher.destroy();
    },
  };
}
