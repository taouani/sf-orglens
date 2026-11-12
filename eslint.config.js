import js from '@eslint/js';
import { defineConfig, globalIgnores } from 'eslint/config';
import tseslint from 'typescript-eslint';
import orglens from './tools/eslint-plugin-orglens.js';

const nodeGlobals = { console: 'readonly', process: 'readonly', URL: 'readonly' };

export default defineConfig(
  globalIgnores(['**/dist/**', '**/coverage/**', '**/test/golden/**', '.corpora/**']),
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
  {
    // The layer rules. See tools/eslint-plugin-orglens.js and layers.cjs.
    files: ['packages/**/*.ts'],
    plugins: { orglens },
    rules: { 'orglens/layers': 'error' },
  },
  {
    // Keys, comparisons and sort orders must be the same on every machine, whatever its locale.
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-syntax': [
        'error',
        {
          selector: 'CallExpression[callee.property.name=/^(toLocaleLowerCase|toLocaleUpperCase|localeCompare)$/]',
          message:
            'The result depends on the locale of the machine. Use toLowerCase, toUpperCase or a plain comparison.',
        },
      ],
    },
  },
  {
    files: ['**/*.cjs'],
    languageOptions: { sourceType: 'commonjs', globals: { module: 'writable', require: 'readonly' } },
  },
  {
    files: ['scripts/**/*.mjs', 'bench/**/*.mjs', 'tools/**/*.js'],
    languageOptions: { globals: nodeGlobals },
  },
);
