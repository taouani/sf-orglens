/**
 * The Salesforce libraries, loaded when they are first needed.
 *
 * Importing them costs about half a second, so no command that works
 * without them pays for it. They are told beforehand not to write a log
 * file into the home folder. They read that from the environment and
 * nowhere else, so the variable is set for this process and stays set,
 * whatever it was before.
 */
import type * as Jsforce from '@jsforce/jsforce-node';
import type * as MetadataSchema from '@jsforce/jsforce-node/lib/api/metadata/schema.js';
import type * as Soap from '@jsforce/jsforce-node/lib/soap.js';
import type * as Core from '@salesforce/core';
import type * as SourceLibrary from '@salesforce/source-deploy-retrieve';
import type * as Undici from 'undici';

let core: Promise<typeof Core> | undefined;
let sourceLibrary: Promise<typeof SourceLibrary> | undefined;
let jsforce: Promise<typeof Jsforce> | undefined;
let soap: Promise<SoapLibrary> | undefined;
let undici: Promise<typeof Undici> | undefined;

const quiet = (): void => {
  process.env['SF_DISABLE_LOG_FILE'] = 'true';
};

/** `@salesforce/core`: the logins of the Salesforce CLI, and connections to an org. */
export function loadCore(): Promise<typeof Core> {
  quiet();
  core ??= import('@salesforce/core');
  return core;
}

/** `@salesforce/source-deploy-retrieve`: which files make up which metadata component. */
export function loadSourceLibrary(): Promise<typeof SourceLibrary> {
  quiet();
  sourceLibrary ??= import('@salesforce/source-deploy-retrieve');
  return sourceLibrary;
}

/** `@jsforce/jsforce-node`: the HTTP client the two libraries above talk to Salesforce with. */
export function loadJsforce(): Promise<typeof Jsforce> {
  quiet();
  jsforce ??= import('@jsforce/jsforce-node');
  return jsforce;
}

/** What a request to the Metadata API is made with. */
export interface SoapLibrary {
  readonly SOAP: typeof Soap.SOAP;
  readonly ApiSchemas: typeof MetadataSchema.ApiSchemas;
}

/**
 * The part of the HTTP client that sends one request to a SOAP API, and
 * the description of the answers of the Metadata API.
 *
 * Both are files inside the package, not names it exports. The client's
 * own way to the Metadata API (`connection.metadata`) is built from these
 * two and takes no options: no time limit of ours, and no way to ask for
 * the state of a retrieve without its zip file. The version of the package
 * is pinned, and the tests of `metadata-api.ts` fail if the files move.
 */
export function loadSoap(): Promise<SoapLibrary> {
  quiet();
  soap ??= Promise.all([
    import('@jsforce/jsforce-node/lib/soap.js'),
    import('@jsforce/jsforce-node/lib/api/metadata/schema.js'),
  ]).then(([client, schema]) => ({ SOAP: client.SOAP, ApiSchemas: schema.ApiSchemas }));
  return soap;
}

/**
 * `undici`: the HTTP client below the Salesforce libraries. The requests
 * to the Metadata API are sent with it directly, so that one time limit
 * covers a whole answer and a connection that breaks is a failure of the
 * request and not of the process.
 */
export function loadUndici(): Promise<typeof Undici> {
  undici ??= import('undici');
  return undici;
}
