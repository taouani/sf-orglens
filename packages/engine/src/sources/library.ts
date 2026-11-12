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
import type * as Core from '@salesforce/core';
import type * as SourceLibrary from '@salesforce/source-deploy-retrieve';

let core: Promise<typeof Core> | undefined;
let sourceLibrary: Promise<typeof SourceLibrary> | undefined;
let jsforce: Promise<typeof Jsforce> | undefined;

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
