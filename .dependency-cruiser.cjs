/**
 * Layer rules for dependency-cruiser.
 *
 *   core <- sources <- extraction <- store <- engines <- api
 *
 * Clients (the CLI now, a local server and UI later) reach the engine only
 * through its package entry point.
 */
const { layers } = require('./layers.cjs');

const layerPath = (layer) => `^packages/engine/src/${layer}/`;

const forbidden = [
  { name: 'no-circular', severity: 'error', from: {}, to: { circular: true } },
  {
    name: 'clients-use-engine-api-only',
    comment: 'Clients may import the engine only through its package entry point.',
    severity: 'error',
    from: { path: '^packages/(?!engine/)' },
    to: { path: '^packages/engine/', pathNot: '^packages/engine/(src|dist)/index\\.(ts|js|d\\.ts)$' },
  },
  {
    name: 'engine-never-imports-clients',
    severity: 'error',
    from: { path: '^packages/engine/' },
    to: { path: '^packages/(?!engine/)' },
  },
  {
    name: 'salesforce-sdk-only-in-sources',
    comment: 'Only the sources layer of the engine talks to Salesforce.',
    severity: 'error',
    from: { pathNot: '^packages/engine/src/sources/' },
    to: { path: '(^|node_modules/)(@salesforce|@jsforce|jsforce)/' },
  },
];

layers.forEach((layer, index) => {
  const later = layers.slice(index + 1);
  if (later.length > 0) {
    forbidden.push({
      name: `layer-${layer}-no-forward-imports`,
      comment: `${layer} must not import from a later layer (${later.join(', ')}).`,
      severity: 'error',
      from: { path: layerPath(layer) },
      to: { path: later.map(layerPath) },
    });
  }
});

module.exports = {
  forbidden,
  options: {
    doNotFollow: { path: 'node_modules' },
    exclude: { path: ['/dist/', '/test/'] },
    tsPreCompilationDeps: true,
    tsConfig: { fileName: 'tsconfig.base.json' },
    enhancedResolveOptions: {
      exportsFields: ['exports'],
      conditionNames: ['@sf-orglens/source', 'import', 'types', 'default'],
      extensions: ['.ts', '.js'],
    },
  },
};
