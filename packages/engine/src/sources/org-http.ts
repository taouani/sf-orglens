/**
 * How a request to an API of an org is sent, and how its failure is named.
 *
 * Every request has a time limit for the whole answer and follows no
 * redirect. The session is sent to the address that issued it and to no
 * other: an answer that points elsewhere is a failure, not a place to go.
 * A request is sent with the HTTP client directly, not the way the client
 * of the Salesforce library would send it: that way limits only the time
 * until an answer starts, follows redirects, and lets a connection that
 * breaks in the middle of an answer end the process.
 *
 * The Metadata API (`metadata-api.ts`) and the Dependency API
 * (`dependency-api.ts`) are asked through this.
 */
import { PassThrough } from 'node:stream';
import { loadUndici } from './library.ts';
import { isFailedRenewal, networkCode, saidBy } from './org-errors.ts';

/**
 * Why a request to an API of the org failed.
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

/** The numbers a request is made with. */
export interface RequestLimits {
  /** The time limit of a request, from sending it to the end of its answer, in milliseconds. */
  readonly requestMs: number;
  /** How often a request that got no answer is made again. */
  readonly repeats: number;
  /** The pause before a request is made again, in milliseconds. It doubles each time. */
  readonly repeatAfterMs: number;
}

/** One HTTP request, as the client of the Salesforce library hands it to what sends it. */
interface HttpRequest {
  readonly method: string;
  readonly url: string;
  readonly headers?: Readonly<Record<string, string>>;
  readonly body?: string;
}

/** What sends the requests of the client of the Salesforce library. */
interface Transport {
  readonly httpRequest: (request: HttpRequest) => unknown;
}

/** The connections to one org. */
export interface OrgHttp {
  /** What the client of the Salesforce library sends a request with, within this time limit. */
  transport(timeout: number): Transport;
  /** True once `close` was called. */
  readonly closed: boolean;
  /** Ends the connections. A request that is under way fails, and no further one is made. */
  close(): Promise<void>;
}

const pause = (ms: number): Promise<void> => new Promise((resolve) => setTimeout(resolve, ms));

/** The code of a fault, without the prefix Salesforce puts before it (`sf:INVALID_TYPE`). */
function faultCode(thrown: unknown): string | null {
  const code = (thrown as { errorCode?: unknown } | null)?.errorCode;
  if (typeof code !== 'string') return null;
  const bare = code.slice(code.lastIndexOf(':') + 1);
  return /^[A-Z][A-Z0-9_]*$/.test(bare) ? bare : null;
}

/**
 * The answers of a gateway before the org, and of an org that is not there for the moment. They are failures to
 * reach the org, not answers of it, and the request is made again.
 */
const NOT_THERE = /^(?:ERROR_HTTP_(?:420|429|5\d\d)|SERVER_UNAVAILABLE)$/;

/**
 * The proxy the Salesforce libraries use for their requests. They take the first of these variables that is set,
 * also if it is set to nothing, which stands for no proxy.
 */
function proxyOfProcess(): string | undefined {
  const { env } = process;
  const value = env['https_proxy'] ?? env['http_proxy'] ?? env['HTTPS_PROXY'] ?? env['HTTP_PROXY'];
  return value === undefined || value === '' ? undefined : value;
}

/** Opens the connections that requests to one org are sent over. They go the way those of the Salesforce libraries go. */
export async function openOrgHttp(): Promise<OrgHttp> {
  const { fetch, Agent, ProxyAgent } = await loadUndici();
  const proxy = proxyOfProcess();
  const dispatcher =
    proxy === undefined
      ? new Agent({ connect: { allowH2: false } })
      : new ProxyAgent({ uri: proxy, requestTls: { allowH2: false } });
  let closed = false;

  return {
    /**
     * Sends one HTTP request and reads the whole answer, within one time limit.
     */
    transport: (timeout) => ({
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
    }),
    get closed() {
      return closed;
    },
    close: async () => {
      closed = true;
      await dispatcher.destroy();
    },
  };
}

/** What was thrown by a request, as the failure it is. */
export function requestFailure(error: unknown): MetadataRequestError {
  if (error instanceof MetadataRequestError) return error;
  const network = networkCode(error);
  if (network !== null) {
    return new MetadataRequestError(
      'unreachable',
      network,
      network === 'TIMEOUT' ? 'The org did not answer in time.' : `The org could not be reached (${network}).`,
      error,
    );
  }
  const code = faultCode(error);
  if (code === 'INVALID_SESSION_ID' || isFailedRenewal(error)) {
    return new MetadataRequestError('session', code, 'The org does not accept the session.', error);
  }
  if (code !== null && NOT_THERE.test(code)) {
    const status = code.replace('ERROR_HTTP_', 'HTTP_');
    return new MetadataRequestError('unreachable', status, `The org could not be reached (${status}).`, error);
  }
  // Salesforce begins the sentence of a fault with its code. The code has a field of its own here.
  const said = saidBy(error);
  const words = code !== null && said.startsWith(`${code}:`) ? said.slice(code.length + 1).trimStart() : said;
  return new MetadataRequestError('refused', code, words, error);
}

/**
 * Makes a request, and again if no answer came. `send` makes it once and throws a `MetadataRequestError` when it
 * fails.
 */
export async function repeated<T>(http: OrgHttp, limits: RequestLimits, send: () => Promise<T>): Promise<T> {
  for (let attempt = 0; ; attempt += 1) {
    try {
      if (http.closed) {
        throw new MetadataRequestError('unreachable', 'CLOSED', 'The connection to the org was closed.');
      }
      return await send();
    } catch (error) {
      const again =
        error instanceof MetadataRequestError &&
        error.kind === 'unreachable' &&
        attempt < limits.repeats &&
        !http.closed;
      if (!again) throw error;
      await pause(limits.repeatAfterMs * 2 ** attempt);
    }
  }
}
