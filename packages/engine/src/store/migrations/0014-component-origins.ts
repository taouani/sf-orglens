import type { Migration } from './migration.ts';

/**
 * The origins of the references that the JavaScript and the markup of Lightning components, Aura components and
 * Visualforce pages give (decision record 0094). The list of origins is closed, and the store keeps it as a table.
 */
export const migration0014: Migration = {
  version: 14,
  name: 'component-origins',
  sql: `
INSERT INTO reference_vocabulary (family, code, name) VALUES
  ('origin', 7, 'parser:javascript'), ('origin', 8, 'parser:markup');
`,
};
