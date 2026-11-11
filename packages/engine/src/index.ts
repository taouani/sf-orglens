/**
 * Public entry point of the OrgLens engine.
 *
 * Everything a client may use is re-exported from the `api` layer. Nothing
 * else in this package is reachable from outside: the package `exports` map
 * exposes only this file.
 */
export * from './api/index.ts';
