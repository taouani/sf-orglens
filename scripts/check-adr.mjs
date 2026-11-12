/*
 * Checks the decision records in docs/adr.
 *
 *   - Every record is named NNNN-kebab-title.md, numbered without gaps, and its heading carries the same number.
 *   - Every record has a status, a date, a decisions line and the three sections.
 *   - Every decision id of the re-architecture plan (F1 to M5) is covered by exactly one record.
 *   - The index in docs/adr/README.md lists every record with its current title and status.
 *   - Links between records point at files that exist.
 */
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'adr');

/** The decisions agreed in docs/plans/re-architecture-plan.md, by area. */
const PLAN_DECISIONS = { F: 4, A: 5, D: 7, S: 6, M: 5 };
const expectedIds = Object.entries(PLAN_DECISIONS).flatMap(([area, count]) =>
  Array.from({ length: count }, (_, i) => `${area}${String(i + 1)}`),
);

const STATUSES = ['Proposed', 'Accepted', 'Superseded'];
const SECTIONS = ['## Context', '## Decision', '## Consequences'];

const problems = [];
const problem = (file, message) => problems.push(`${file}: ${message}`);

const files = readdirSync(dir).sort();
const records = files.filter((name) => /^\d{4}-/.test(name) && name !== '0000-template.md');
const index = readFileSync(join(dir, 'README.md'), 'utf8');
const coveredBy = new Map();

records.forEach((file, position) => {
  const text = readFileSync(join(dir, file), 'utf8').replaceAll('\r\n', '\n');
  const number = file.slice(0, 4);

  if (!/^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/.test(file)) problem(file, 'file name is not NNNN-kebab-title.md');
  if (Number(number) !== position + 1) problem(file, `expected number ${String(position + 1).padStart(4, '0')}`);

  const heading = /^# (\d{4})\. (.+)$/m.exec(text);
  if (!heading || !text.startsWith('# ')) problem(file, 'first line is not "# NNNN. Title"');
  else if (heading[1] !== number) problem(file, `heading says ${heading[1]}`);

  const status = /^- Status: (.+)$/m.exec(text)?.[1];
  if (!status) problem(file, 'no "- Status:" line');
  else if (!STATUSES.some((allowed) => status === allowed || status.startsWith(`${allowed} `))) {
    problem(file, `status "${status}" is not one of ${STATUSES.join(', ')}`);
  }
  if (!/^- Date: \d{4}-\d{2}-\d{2}$/m.test(text)) problem(file, 'no "- Date: YYYY-MM-DD" line');

  const decisions = /^- Decisions: (.+)$/m.exec(text)?.[1];
  if (!decisions) problem(file, 'no "- Decisions:" line');
  const ids = decisions?.match(/\b[FADSM]\d\b/g) ?? [];
  if (decisions && ids.length === 0 && !decisions.startsWith('none')) {
    problem(file, 'the decisions line names no decision id and does not say "none"');
  }
  for (const id of ids) {
    if (!expectedIds.includes(id)) problem(file, `unknown decision id ${id}`);
    coveredBy.set(id, [...(coveredBy.get(id) ?? []), file]);
  }

  let cursor = 0;
  for (const section of SECTIONS) {
    const at = text.indexOf(`\n${section}\n`, cursor);
    if (at === -1) problem(file, `section "${section}" is missing or out of order`);
    else cursor = at + 1;
  }

  for (const [, target] of text.matchAll(/\]\((?!https?:)([^)#]+)(?:#[^)]*)?\)/g)) {
    try {
      readFileSync(join(dir, target));
    } catch {
      problem(file, `link to "${target}" does not resolve`);
    }
  }

  if (heading && status) {
    const row = index.split('\n').find((line) => line.startsWith('|') && line.includes(`](${file})`));
    if (!row) problem('README.md', `the index does not list ${file}`);
    else {
      const cells = row.split('|').map((cell) => cell.trim());
      if (!cells.includes(heading[2])) problem('README.md', `the index title for ${file} differs from its heading`);
      if (!cells.includes(status)) problem('README.md', `the index status for ${file} differs from the record`);
      if (cells.at(-2) !== ids.join(', '))
        problem('README.md', `the index decisions for ${file} differ from the record`);
    }
  }
});

for (const id of expectedIds) {
  const owners = coveredBy.get(id) ?? [];
  if (owners.length === 0) problem('docs/adr', `decision ${id} is not covered by any record`);
  if (owners.length > 1) problem('docs/adr', `decision ${id} is covered by more than one record: ${owners.join(', ')}`);
}

for (const [, target] of index.matchAll(/\]\((\d{4}-[^)]+\.md)\)/g)) {
  if (!files.includes(target)) problem('README.md', `the index links to ${target}, which does not exist`);
}

if (records.length === 0) problem('docs/adr', 'no decision records found');

if (problems.length > 0) {
  console.error(problems.map((line) => `FAIL ${line}`).join('\n'));
  console.error(`\n${String(problems.length)} problem(s) in the decision records.`);
  process.exit(1);
}
console.log(
  `${String(records.length)} decision records checked: ${String(expectedIds.length)} plan decisions covered once each.`,
);
