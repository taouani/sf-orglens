/**
 * The engine layers, in dependency order. A layer may import from layers that
 * come before it in this list and never from layers that come after it.
 *
 * This is the single definition used by the ESLint rule
 * (`tools/eslint-plugin-orglens.js`), dependency-cruiser
 * (`.dependency-cruiser.cjs`) and the boundary check
 * (`scripts/check-boundaries.mjs`).
 */
const layers = ['core', 'sources', 'extraction', 'store', 'engines', 'api'];

/** The one layer that may import the Salesforce libraries. */
const salesforceLayer = 'sources';

/** Package names that only `salesforceLayer` may import. A name matches itself and its subpaths. */
const salesforcePackages = ['@salesforce', '@jsforce', 'jsforce'];

/** Packages a client must never import: clients reach data only through the engine API. */
const clientForbiddenPackages = ['node:sqlite', 'sqlite', 'better-sqlite3', 'fast-xml-parser'];

/** The name of the engine package, the only engine import a client may use. */
const enginePackage = '@sf-orglens/engine';

module.exports = { layers, salesforceLayer, salesforcePackages, clientForbiddenPackages, enginePackage };
