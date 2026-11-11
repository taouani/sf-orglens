import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import layering from './layers.cjs';

const { layers, salesforcePackages } = layering;

const nodeGlobals = { console: 'readonly', process: 'readonly', URL: 'readonly' };

const salesforceRestriction = {
  group: salesforcePackages,
  message: 'Only the sources layer of the engine talks to Salesforce.',
};

/** One config block per engine layer: no imports from the layers after it. */
const layerRules = layers.map((layer, index) => {
  const later = layers.slice(index + 1);
  const patterns = [];
  if (later.length > 0) {
    patterns.push({
      regex: `^(\\.\\./)+(${later.join('|')})(/|$)`,
      message: `The ${layer} layer must not import from a later layer (${later.join(', ')}).`,
    });
  }
  if (layer !== 'sources') patterns.push(salesforceRestriction);
  return {
    files: [`packages/engine/src/${layer}/**/*.ts`],
    rules: { 'no-restricted-imports': ['error', { patterns }] },
  };
});

export default defineConfig(
  globalIgnores(['**/dist/**', '**/coverage/**', '**/test/golden/**']),
  js.configs.recommended,
  {
    files: ['**/*.ts'],
    extends: [tseslint.configs.strictTypeChecked, tseslint.configs.stylisticTypeChecked],
    languageOptions: {
      parserOptions: {
        projectService: { allowDefaultProject: ['vitest.config.ts'] },
        tsconfigRootDir: import.meta.dirname,
      },
    },
    rules: {
      '@typescript-eslint/consistent-type-imports': 'error',
      '@typescript-eslint/no-floating-promises': 'error',
    },
  },
  ...layerRules,
  {
    // Clients may only use the engine's public entry point.
    files: ['packages/cli/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            {
              group: ['@sf-orglens/engine/*', '**/engine/src/**', '**/engine/dist/**'],
              message: 'Clients use only the public engine API (@sf-orglens/engine).',
            },
            {
              group: [...salesforcePackages, 'node:sqlite', 'better-sqlite3', 'fast-xml-parser'],
              message: 'Clients never talk to Salesforce, the store or the parsers directly.',
            },
          ],
        },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: nodeGlobals },
  },
);
