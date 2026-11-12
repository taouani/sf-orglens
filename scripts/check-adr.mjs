/*
 * Checks the decision records in docs/adr.
 *
 *   - The folder holds only records, the index, the template and legacy.md.
 *   - Every record is named NNNN-kebab-title.md, numbered without gaps, and its first line carries the same number.
 *   - Every record has a valid status, a real date, a decisions line and the three sections, none of them empty.
 *   - Every decision id in the decision log of the re-architecture plan is listed by exactly one record that has
 *     not been superseded.
 *   - The index in docs/adr/README.md has one row per record, in order, with its current title, status and ids.
 *   - Links to files, in every Markdown file of the folder, point at something that exists.
 *
 * Not checked: that the text of a record matches the decisions it lists, and that the anchor of a link exists.
 * Both are for review.
 */
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const dir = join(dirname(fileURLToPath(import.meta.url)), '..', 'docs', 'adr');
const planFile = join(dir, '..', 'plans', 're-architecture-plan.md');

const INDEX = 'README.md';
const TEMPLATE = '0000-template.md';
const OTHER_FILES = [INDEX, TEMPLATE, 'legacy.md'];
const RECORD_NAME = /^\d{4}-[a-z0-9]+(-[a-z0-9]+)*\.md$/;
const SECTIONS = ['## Context', '## Decision', '## Consequences'];
const SUPERSEDED_BY = /^Superseded by \[(\d{4})\]\((\d{4}-[a-z0-9-]+\.md)\)$/;

const problems = [];
const problem = (file, message) => problems.push(`${file}: ${message}`);
const read = (path) => readFileSync(path, 'utf8').replaceAll('\r\n', '\n');

// The decision ids are read from the decision log of the plan: table rows that start with an id such as "| F1 |".
const expectedIds = [...read(planFile).matchAll(/^\| ([A-Z]\d+) \|/gm)].map((match) => match[1]);
if (expectedIds.length === 0) problem('re-architecture-plan.md', 'no decision ids found in the decision log');
if (new Set(expectedIds).size !== expectedIds.length) {
  problem('re-architecture-plan.md', 'a decision id appears twice in the decision log');
}

// What the folder holds.
const markdownFiles = [];
const records = [];
for (const entry of readdirSync(dir, { withFileTypes: true }).sort((a, b) => (a.name < b.name ? -1 : 1))) {
  if (!entry.isFile()) {
    problem(entry.name, 'docs/adr holds files only');
  } else if (OTHER_FILES.includes(entry.name)) {
    markdownFiles.push(entry.name);
  } else if (RECORD_NAME.test(entry.name)) {
    markdownFiles.push(entry.name);
    records.push(entry.name);
  } else {
    problem(entry.name, 'is not a record named NNNN-kebab-title.md, the index, the template or legacy.md');
  }
}
for (const file of OTHER_FILES) {
  if (!markdownFiles.includes(file)) problem(file, 'is missing');
}

/** Checks the lines and sections every record has, and returns what the other checks need. */
function checkShape(file, text, { template }) {
  const heading = /^# (\d{4}|NNNN)\. (\S.*)\n/.exec(text);
  if (!heading) problem(file, 'the first line is not "# NNNN. Title"');

  const rawStatus = /^- Status: (.*)$/m.exec(text)?.[1];
  const status = rawStatus?.trim();
  if (status === undefined || status === '') problem(file, 'no "- Status:" line');
  else if (rawStatus !== status) problem(file, 'the status line has spaces at its end');

  const date = /^- Date: (.*)$/m.exec(text)?.[1];
  if (date === undefined) problem(file, 'no "- Date:" line');
  else if (!template) {
    const parsed = new Date(`${date}T00:00:00Z`);
    if (
      !/^\d{4}-\d{2}-\d{2}$/.test(date) ||
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString().slice(0, 10) !== date
    ) {
      problem(file, `"${date}" is not a date written YYYY-MM-DD`);
    }
  }

  const decisions = /^- Decisions: (.+)$/m.exec(text)?.[1];
  if (decisions === undefined) problem(file, 'no "- Decisions:" line');

  let cursor = 0;
  for (const section of SECTIONS) {
    const at = text.indexOf(`\n${section}\n`, cursor);
    if (at === -1) {
      problem(file, `section "${section}" is missing or out of order`);
      continue;
    }
    const bodyStart = at + section.length + 2;
    const nextSection = text.indexOf('\n## ', bodyStart - 1);
    const body = text.slice(bodyStart, nextSection === -1 ? undefined : nextSection);
    if (body.trim() === '') problem(file, `section "${section}" is empty`);
    cursor = at + 1;
  }
  return { heading, status, decisions };
}

/** Checks that every link to a file resolves. Code spans are skipped, and so are web and mail addresses. */
function checkLinks(file, text) {
  const prose = text.replace(/```[\s\S]*?```/g, '').replace(/`[^`\n]*`/g, '');
  for (const [, target] of prose.matchAll(/\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)) {
    if (/^[a-z][a-z0-9+.-]*:/i.test(target) || target.startsWith('#')) continue;
    const path = target.split('#')[0];
    if (!existsSync(join(dir, path))) problem(file, `link to "${path}" does not resolve`);
  }
}

const texts = new Map(markdownFiles.map((file) => [file, read(join(dir, file))]));
for (const [file, text] of texts) checkLinks(file, text);
if (texts.has(TEMPLATE)) checkShape(TEMPLATE, texts.get(TEMPLATE), { template: true });

// The records.
const numbersSeen = new Map();
const coveredBy = new Map();
const facts = new Map();

records.forEach((file, position) => {
  const number = file.slice(0, 4);
  const earlier = numbersSeen.get(number);
  if (earlier) problem(file, `has the same number as ${earlier}`);
  else numbersSeen.set(number, file);
  if (Number(number) !== position + 1) problem(file, `expected number ${String(position + 1).padStart(4, '0')}`);

  const { heading, status, decisions } = checkShape(file, texts.get(file), { template: false });
  if (heading && heading[1] !== number) problem(file, `the heading says ${heading[1]}`);

  let superseded = false;
  if (status) {
    const supersededBy = SUPERSEDED_BY.exec(status);
    superseded = supersededBy !== null;
    if (supersededBy) {
      const [, linkNumber, target] = supersededBy;
      if (!target.startsWith(`${linkNumber}-`)) problem(file, 'the link text of the status differs from its target');
      if (target === file || !records.includes(target)) problem(file, `superseded by "${target}", which is no record`);
    } else if (status !== 'Proposed' && status !== 'Accepted') {
      problem(file, `status "${status}" is not Proposed, Accepted or "Superseded by [NNNN](NNNN-title.md)"`);
    }
  }

  const ids = decisions?.match(/\b[A-Z]\d+\b/g) ?? [];
  if (decisions && ids.length === 0 && !decisions.startsWith('none')) {
    problem(file, 'the decisions line names no decision id and does not say "none"');
  }
  for (const id of ids) {
    if (!expectedIds.includes(id)) problem(file, `unknown decision id ${id}`);
    // A superseded record keeps its ids for the reader, and the record that replaces it takes them over.
    else if (!superseded) coveredBy.set(id, [...(coveredBy.get(id) ?? []), file]);
  }
  facts.set(file, { number, title: heading?.[2], status, ids });
});

for (const id of expectedIds) {
  const owners = coveredBy.get(id) ?? [];
  if (owners.length === 0) problem('docs/adr', `decision ${id} is not covered by any record in force`);
  if (owners.length > 1) problem('docs/adr', `decision ${id} is covered by more than one record: ${owners.join(', ')}`);
}
if (records.length === 0) problem('docs/adr', 'no decision records found');

// The index: one row per record, in order. A row is recognised by a link to a record in its first cell.
const rows = (texts.get(INDEX) ?? '')
  .split('\n')
  .filter((line) => line.startsWith('|'))
  .map((line) => line.split('|').map((cell) => cell.trim()))
  .filter((cells) => /^\[[^\]]*\]\(\d{4}-[^)]*\)$/.test(cells[1] ?? ''));

for (const [file, { number, title, status, ids }] of facts) {
  const firstCell = `[${number}](${file})`;
  const own = rows.filter((cells) => cells[1] === firstCell);
  if (own.length === 0) problem(INDEX, `the index has no row that starts with ${firstCell}`);
  if (own.length > 1) problem(INDEX, `the index lists ${file} more than once`);
  const cells = own[0];
  if (!cells) continue;
  if (title !== undefined && cells[2] !== title) problem(INDEX, `the index title for ${file} differs from its heading`);
  if (status !== undefined && cells[3] !== status)
    problem(INDEX, `the index status for ${file} differs from the record`);
  if (cells[4] !== ids.join(', ')) problem(INDEX, `the index decisions for ${file} differ from the record`);
}
const expectedFirstCells = [...facts].map(([file, { number }]) => `[${number}](${file})`);
for (const cells of rows) {
  if (!expectedFirstCells.includes(cells[1])) problem(INDEX, `the index row ${cells[1]} matches no record`);
}
const listed = rows.map((cells) => cells[1]).filter((cell) => expectedFirstCells.includes(cell));
if (listed.join() !== expectedFirstCells.filter((cell) => listed.includes(cell)).join()) {
  problem(INDEX, 'the index rows are not in the order of the records');
}

if (problems.length > 0) {
  console.error(problems.map((line) => `FAIL ${line}`).join('\n'));
  console.error(`\n${String(problems.length)} problem(s) in the decision records.`);
  process.exit(1);
}
console.log(
  `${String(records.length)} decision records checked: ${String(expectedIds.length)} plan decisions covered once each.`,
);
