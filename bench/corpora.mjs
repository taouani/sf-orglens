/*
 * Times the commands of OrgLens on the public codebases of fixtures/corpora.toml, as a person would run them:
 * the built command line, a new process for every command, with the start of Node.js and the printing.
 *
 *   node bench/corpora.mjs [name ...] [--runs n] [--copies n] [--out file.json]
 *
 *   name      the codebases to time. Default: every one that was downloaded (pnpm run corpora:fetch)
 *   --runs    how often each command is run, default 5. The smallest and the largest time are printed
 *   --copies  also time a made-up source: the first named codebase, with every object of it copied n times
 *             under another name. It stands for an org with many objects and fields. Nothing of it is real
 *
 * It needs a build (pnpm run build) and no network. Every run of a codebase gets a workspace of its own in a
 * temporary folder, so that every snapshot is a first snapshot. The folders are removed at the end, also when
 * the script fails or is interrupted. The codebases are read where they lie and are never changed.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

const root = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const bin = path.join(root, 'packages/cli/dist/bin.js');

const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
/** Takes an option with its value out of the arguments. */
function option(name, fallback) {
  const at = args.indexOf(name);
  if (at === -1) return fallback;
  const [, value] = args.splice(at, 2);
  if (value === undefined || value.startsWith('--')) usage();
  return value;
}
function usage() {
  console.error('usage: node bench/corpora.mjs [name ...] [--runs n] [--copies n] [--out file.json]');
  process.exit(2);
}
const runs = Number(option('--runs', '5'));
const copies = Number(option('--copies', '0'));
const outFile = option('--out', undefined);
if (!(Number.isInteger(runs) && runs >= 1) || !(Number.isInteger(copies) && copies >= 0)) usage();
if (args.some((arg) => arg.startsWith('--'))) usage();

if (!fs.existsSync(bin)) {
  console.error('The command line is not built. Run "pnpm run build" first.');
  process.exit(1);
}
const manifest = parse(fs.readFileSync(path.join(root, 'fixtures/corpora.toml'), 'utf8')).corpus;
for (const name of args) {
  if (!manifest.some((corpus) => corpus.name === name)) {
    console.error(`fixtures/corpora.toml lists no codebase "${name}".`);
    process.exit(2);
  }
}

const remove = (folder) => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
const temporary = fs.mkdtempSync(path.join(os.tmpdir(), 'orglens-corpora-'));
process.on('exit', () => remove(temporary));
// A run that is interrupted removes its folder too: without this, Ctrl+C ends the process before 'exit'.
for (const signal of ['SIGINT', 'SIGTERM']) process.on(signal, () => process.exit(130));

const now = () => Number(process.hrtime.bigint()) / 1e6;
const seconds = (milliseconds) => +(milliseconds / 1000).toFixed(2);
const range = (times) => ({ least: seconds(Math.min(...times)), most: seconds(Math.max(...times)) });

/** Runs one command in a workspace and gives its time and what it printed. A command that fails ends the script. */
function orglens(workspace, command, allowed = [0]) {
  const start = now();
  const result = spawnSync(process.execPath, [bin, ...command], {
    cwd: workspace,
    encoding: 'utf8',
    maxBuffer: 1 << 30,
  });
  const milliseconds = now() - start;
  if (!allowed.includes(result.status)) {
    throw new Error(`orglens ${command.join(' ')} ended with ${String(result.status)}: ${result.stderr}`);
  }
  return { milliseconds, stdout: result.stdout, status: result.status };
}

/** A new workspace with one source: folders of a repository, read from disk as they are. */
function workspaceFor(name, repository, paths) {
  const workspace = fs.mkdtempSync(path.join(temporary, 'workspace-'));
  orglens(workspace, ['init']);
  const repo = path.relative(workspace, repository).split(path.sep).join('/');
  fs.appendFileSync(
    path.join(workspace, 'orglens.toml'),
    `\n[sources.${name}]\nkind = "git"\nrepo = ${JSON.stringify(repo)}\npaths = ${JSON.stringify(paths)}\n`,
  );
  return workspace;
}

/** The fields of a codebase by the names of its files, as `Object.Field`, sorted. At most `most` of them. */
function fieldsOf(repository, paths, most) {
  const fields = [];
  const find = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      const at = path.join(folder, entry.name);
      if (entry.isDirectory()) find(at);
      else if (entry.name.endsWith('.field-meta.xml') && path.basename(path.dirname(at)) === 'fields') {
        const object = path.basename(path.dirname(path.dirname(at)));
        fields.push(`${object}.${entry.name.slice(0, -'.field-meta.xml'.length)}`);
      }
    }
  };
  for (const one of paths) find(path.join(repository, one));
  return fields.sort().slice(0, most);
}

/**
 * The field that most components refer to, and the first that a single component refers to, by the JSON
 * output of `impact` for the fields of the codebase.
 */
function fieldsToAsk(workspace, name, fields) {
  let hub;
  let ordinary;
  for (const field of fields) {
    const asked = orglens(workspace, ['impact', field, '--source', name, '--json'], [0, 2, 5]);
    // A name that fits two components, or none, is not a question this benchmark asks.
    if (asked.status === 2) continue;
    const count = JSON.parse(asked.stdout).data.results.length;
    if (hub === undefined || count > hub.count) hub = { field, count };
    if (count === 1 && ordinary === undefined) ordinary = { field, count };
  }
  return { hub, ordinary };
}

/**
 * Times the commands on one source, `runs` times, each in a workspace of its own. `questions` are the fields
 * to ask about, or the list of fields to choose them from.
 */
function time(name, repository, paths, questions) {
  const times = { snapshot: [], analyse: [], coverage: [], impactHub: [], impactOrdinary: [], impactJson: [] };
  let facts;
  for (let run = 0; run < runs; run++) {
    const workspace = workspaceFor(name, repository, paths);
    // A snapshot that lacks something ends with 5 and is still a snapshot.
    const snapshot = orglens(workspace, ['snapshot', name, '--json'], [0, 5]);
    times.snapshot.push(snapshot.milliseconds);
    if (facts === undefined) {
      const { data } = JSON.parse(snapshot.stdout);
      facts = {
        report: {
          status: data.snapshot.status,
          files: data.snapshot.files,
          megabytes: +(data.snapshot.bytes / 1048576).toFixed(1),
          components: data.analysis.components,
          references: data.analysis.references,
          analysed: data.types.reduce((sum, type) => sum + type.analysed, 0),
        },
        ...(Array.isArray(questions) ? fieldsToAsk(workspace, name, questions) : questions),
      };
    }
    times.analyse.push(orglens(workspace, ['analyse', name], [0, 5]).milliseconds);
    times.coverage.push(orglens(workspace, ['coverage', name], [0, 5]).milliseconds);
    if (facts.hub !== undefined) {
      const ask = ['impact', facts.hub.field, '--source', name];
      times.impactHub.push(orglens(workspace, ask, [0, 5]).milliseconds);
      const asJson = orglens(workspace, [...ask, '--json'], [0, 5]);
      times.impactJson.push(asJson.milliseconds);
      facts.hubResults = JSON.parse(asJson.stdout).data.results.length;
    }
    if (facts.ordinary !== undefined) {
      const ask = ['impact', facts.ordinary.field, '--source', name];
      times.impactOrdinary.push(orglens(workspace, ask, [0, 5]).milliseconds);
    }
    if (run === runs - 1) {
      const database = path.join(workspace, '.orglens/orglens.db');
      facts.databaseBytes = fs.statSync(database).size;
    }
    remove(workspace);
  }
  return {
    name,
    runs,
    snapshot: facts.report,
    databaseMegabytes: +(facts.databaseBytes / 1048576).toFixed(1),
    hub: facts.hub === undefined ? undefined : { field: facts.hub.field, results: facts.hubResults },
    ordinary: facts.ordinary?.field,
    seconds: Object.fromEntries(
      Object.entries(times)
        .filter(([, list]) => list.length > 0)
        .map(([command, list]) => [command, range(list)]),
    ),
  };
}

/** The name of an object in its copy `n`: `Invoice__c` becomes `Invoice_n__c`, and `Account` `Account_n__c`. */
function copyName(object, n) {
  const ending = /__(?:c|mdt|e|x|b)$/i.exec(object)?.[0] ?? '';
  return `${object.slice(0, object.length - ending.length)}_${String(n)}${ending === '' ? '__c' : ending}`;
}

/**
 * A copy of a codebase with every folder of an object copied `count` times under another name, in a package
 * folder of its own. A copy keeps its files as they are, so a lookup of it leads to the object it led to.
 */
function withCopies(corpus, count) {
  const repository = path.join(temporary, `${corpus.name}-copies`);
  for (const one of corpus.paths) {
    fs.cpSync(path.join(root, '.corpora', corpus.name, one), path.join(repository, one), { recursive: true });
  }
  const objects = [];
  const find = (folder) => {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (!entry.isDirectory()) continue;
      const at = path.join(folder, entry.name);
      if (entry.name === 'objects') objects.push(...fs.readdirSync(at).map((name) => path.join(at, name)));
      else find(at);
    }
  };
  for (const one of corpus.paths) find(path.join(repository, one));
  for (let n = 1; n <= count; n++) {
    for (const folder of objects) {
      const object = path.basename(folder);
      const target = path.join(repository, 'copies', 'objects', copyName(object, n));
      fs.cpSync(folder, target, { recursive: true });
      const file = path.join(target, `${object}.object-meta.xml`);
      if (fs.existsSync(file)) fs.renameSync(file, path.join(target, `${copyName(object, n)}.object-meta.xml`));
    }
  }
  return { repository, paths: [...corpus.paths, 'copies'], objects: objects.length };
}

const results = [];
const asked = manifest.filter((corpus) => args.length === 0 || args.includes(corpus.name));
for (const corpus of asked) {
  const repository = path.join(root, '.corpora', corpus.name);
  if (!fs.existsSync(repository)) {
    console.error(`${corpus.name}: not downloaded. Run "pnpm run corpora:fetch".`);
    continue;
  }
  console.error(`${corpus.name}: ${String(runs)} runs`);
  results.push(time(corpus.name, repository, corpus.paths, fieldsOf(repository, corpus.paths, 1000)));
}
const first = args.length === 0 ? asked[0] : manifest.find((corpus) => corpus.name === args[0]);
const base = results.find((result) => result.name === first?.name);
if (copies > 0 && first !== undefined && base !== undefined) {
  console.error(`${first.name} with ${String(copies)} copies of every object: ${String(runs)} runs`);
  const made = withCopies(first, copies);
  // The questions are those of the codebase itself, so that the two times can be held side by side.
  const questions = {
    hub: base.hub === undefined ? undefined : { field: base.hub.field },
    ordinary: base.ordinary === undefined ? undefined : { field: base.ordinary },
  };
  results.push({
    ...time(`${first.name}-copies`, made.repository, made.paths, questions),
    madeUp: { of: first.name, copies, objects: made.objects },
  });
}

const output = JSON.stringify(
  { node: process.version, platform: `${os.platform()} ${os.arch()}`, cpus: os.cpus().length, results },
  null,
  2,
);
if (outFile !== undefined) fs.writeFileSync(outFile, `${output}\n`);
console.log(output);
