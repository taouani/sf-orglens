import type { Migration } from './migration.ts';

/**
 * The rules and actions of a file of workflow rules are contained in the file (decision record 0063).
 *
 * The parent of a component is stored with the row of its key, when the key is first named, and is the one the
 * key says (`parentKey`). A key such as `WorkflowRule:invoice__c.remind` had no parent before. It has the file of
 * the workflow rules of its object now, `Workflow:invoice__c`: the name of the part up to its first dot. The rows
 * of the parts that the database holds get that parent, and the file gets a row where the database has none, as
 * an analysis does for a parent it names. A name without a dot, or with nothing before or after its first dot,
 * has no parent, as `parentKey` says. A key of a sub-component has its parent already and is left alone.
 */
const TYPES = [
  'WorkflowAlert',
  'WorkflowFieldUpdate',
  'WorkflowFlowAction',
  'WorkflowFlowAutomation',
  'WorkflowKnowledgePublish',
  'WorkflowNotification',
  'WorkflowOutboundMessage',
  'WorkflowRule',
  'WorkflowSend',
  'WorkflowTask',
]
  .map((type) => `'${type}'`)
  .join(', ');

/** The name of the key in the column `key`, after its type. */
const nameOf = (key: string): string => `substr(${key}, instr(${key}, ':') + 1)`;
/** True for the key in the column `key` if it is the key of a part with a parent by its name. */
const isPart = (key: string): string =>
  `substr(${key}, 1, instr(${key}, ':') - 1) IN (${TYPES}) AND instr(${key}, '#') = 0
  AND instr(${nameOf(key)}, '.') > 1 AND instr(${nameOf(key)}, '.') < length(${nameOf(key)})`;
/** The key of the file that the part with the key in the column `key` is contained in. */
const fileOf = (key: string): string => `'Workflow:' || substr(${nameOf(key)}, 1, instr(${nameOf(key)}, '.') - 1)`;

export const migration0008: Migration = {
  version: 8,
  name: 'workflow-parts',
  sql: `
-- The file of the workflow rules of an object, where the database has a part of it and no row for the file.
INSERT OR IGNORE INTO component (key)
SELECT ${fileOf('key')} FROM component WHERE ${isPart('key')};

-- A rule or an action is contained in the file it is a part of.
UPDATE component
SET parent_id = (SELECT file.id FROM component AS file WHERE file.key = ${fileOf('component.key')})
WHERE ${isPart('key')};
`,
};
