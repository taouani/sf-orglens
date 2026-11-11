/**
 * The engine layers, in dependency order. A layer may import from layers that
 * come before it in this list and never from layers that come after it.
 *
 * This is the single definition used by ESLint (`eslint.config.js`),
 * dependency-cruiser (`.dependency-cruiser.cjs`) and the boundary check
 * (`scripts/check-boundaries.mjs`).
 */
const layers = ['core', 'sources', 'extraction', 'store', 'engines', 'api'];

/** Packages that only the `sources` layer may import. */
const salesforcePackages = ['@salesforce/*', '@jsforce/*', 'jsforce', 'jsforce/*'];

module.exports = { layers, salesforcePackages };
