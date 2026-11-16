/*
 * Benchmark of the store of the engine, on the synthetic org of bench/generate.mjs.
 *
 *   node bench/store.mjs [driver] [factor] [snapshots] [--out file.json]
 *
 *   driver     node (the SQLite built into Node.js, default) or bs3 (better-sqlite3)
 *   factor     the size of the org: 1 is the org of Phase 0 (default), 2 is twice as large
 *   snapshots  how many snapshots to write, default 2
 *
 * Unlike bench/bench.mjs it goes through the engine: it opens the database with `openStore`, writes every
 * snapshot with `writeAnalysis` and reads with `sqlGraph`. It measures what a command will see: the size of
 * the database and the time to write one analysis. The time to make the components in memory is given apart,
 * because an analyser makes them, not the store.
 *
 * It builds the database in a temporary folder, prints the measurements as JSON and removes the folder, also
 * when it fails. The next run removes what an interrupted run left more than an hour ago.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildKey } from '../packages/engine/src/core/keys.ts';
import { writeAnalysis } from '../packages/engine/src/store/analysis.ts';
import { loadBetterSqlite3Driver } from '../packages/engine/src/store/better-sqlite3.ts';
import { sqlGraph } from '../packages/engine/src/store/graph.ts';
import { nodeSqliteDriver } from '../packages/engine/src/store/node-sqlite.ts';
import { openStore } from '../packages/engine/src/store/open.ts';
import { ensureSource, insertSnapshot } from '../packages/engine/src/store/snapshots.ts';
import { buildUniverse, contentHash, evolve, initialState } from './generate.mjs';

// Some versions of pnpm pass the "--" of "pnpm run bench:store -- node 2 10" on to the script.
const args = process.argv.slice(2).filter((arg, index) => !(index === 0 && arg === '--'));
const outAt = args.indexOf('--out');
const outFile = outAt === -1 ? undefined : args.splice(outAt, 2)[1];
const [driverName = 'node', factorArg = '1', snapshotsArg = '2'] = args;
const factor = Number(factorArg);
const snapshots = Number(snapshotsArg);
if (
  !['node', 'bs3'].includes(driverName) ||
  !(Number.isFinite(factor) && factor > 0 && factor <= 20) ||
  !(Number.isInteger(snapshots) && snapshots >= 1) ||
  args.length > 3 ||
  (outAt !== -1 && (outFile === undefined || outFile.startsWith('--')))
) {
  console.error('usage: node bench/store.mjs [node|bs3] [factor] [snapshots] [--out file.json]');
  process.exit(2);
}

const remove = (folder) => fs.rmSync(folder, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
for (const name of fs.readdirSync(os.tmpdir())) {
  const leftover = path.join(os.tmpdir(), name);
  try {
    if (name.startsWith('orglens-bench-') && Date.now() - fs.statSync(leftover).mtimeMs > 3_600_000) remove(leftover);
  } catch {
    // Somebody else's folder, or one that is just being removed.
  }
}
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orglens-bench-'));
process.on('exit', () => remove(dir));
const file = path.join(dir, 'orglens.sqlite');

const now = () => Number(process.hrtime.bigint()) / 1e6;
const megabytes = (bytes) => +(bytes / 1048576).toFixed(1);
const seconds = (milliseconds) => +(milliseconds / 1000).toFixed(2);

const universe = buildUniverse(42, factor);
const state = initialState(universe);

// The generator names its components in its own way. The store takes only keys of the engine.
const KIND = ['reads', 'writes', 'calls', 'reads', 'writes', 'references', 'uses-type', 'triggers-on', 'references'];
const ORIGIN = ['parser:apex', 'parser:flow', 'parser:xml', 'dependency-api'];
const keys = new Array(universe.N);
const types = new Array(universe.N);
for (let i = 0; i < universe.N; i++) {
  const parent = universe.parent[i];
  const sub = (type, kind, name) => buildKey({ type, fullName: universe.name[parent], subs: [{ kind, name }] });
  switch (universe.type[i]) {
    case 'CustomField':
      keys[i] = buildKey({ type: 'CustomField', fullName: `${universe.name[parent]}.${universe.name[i]}` });
      break;
    case 'ApexMethod':
      keys[i] = sub('ApexClass', 'method', `${universe.name[i]}()`);
      break;
    case 'FlowElement':
      keys[i] = sub('Flow', 'element', universe.name[i]);
      break;
    default:
      keys[i] =
        parent < 0
          ? buildKey({ type: universe.type[i], fullName: universe.name[i] })
          : sub(universe.type[parent], 'value', universe.name[i]);
  }
  types[i] = keys[i].slice(0, keys[i].indexOf(':'));
}
if (new Set(keys).size !== keys.length) throw new Error('Two components of the synthetic org have one key.');

/** The components of the snapshot as an analyser would hand them to the store. */
function analysed() {
  const { alive, ver } = state;
  const components = [];
  let references = 0;
  for (let i = 0; i < universe.N; i++) {
    if (!alive[i]) continue;
    const top = universe.top[i];
    const from = [];
    for (let at = universe.srcStart[i]; at < universe.srcStart[i + 1]; at++) {
      const j = universe.srcRefs[at];
      const target = universe.rdst[j];
      const origin = ORIGIN[universe.rorigin[j]];
      const confidence = universe.rconf[j];
      from.push({
        from: keys[i],
        to: keys[target],
        toType: types[target],
        toNameRaw: universe.name[target],
        kind: KIND[universe.rkind[j]],
        origin,
        confidence: confidence === 1 ? 'confirmed' : confidence === 0.5 ? 'possible' : 'probable',
        resolution: 'resolved',
        // What Salesforce reports has no place.
        ...(origin === 'dependency-api'
          ? {}
          : { location: { file: universe.path[top], line: universe.rline[j], column: 1 + (j % 80) } }),
      });
    }
    references += from.length;
    components.push({
      key: keys[i],
      name: universe.name[i],
      // As in Phase 0, a change to a file changes everything the file holds.
      definition: { path: universe.path[top], contentHash: contentHash(universe, i, ver[i]) },
      attrs: JSON.parse(universe.attrs(i)),
      references: from,
    });
  }
  return { components, references };
}

const driver = driverName === 'node' ? nodeSqliteDriver : await loadBetterSqlite3Driver();
const store = openStore({ path: file, driver });
const result = {
  driver: store.driverName,
  factor,
  snapshots,
  node: process.version,
  sqlite: String(store.get('SELECT sqlite_version() AS v')?.v),
  write: [],
};
const sourceId = store.write(() =>
  ensureSource(store, { name: 'bench', kind: 'git', createdAt: new Date().toISOString() }),
);
let snapshotId = 0;
for (let s = 1; s <= snapshots; s++) {
  const changes = s > 1 ? evolve(universe, state) : null;
  const made = now();
  const { components, references } = analysed();
  const madeIn = now() - made;
  const at = new Date().toISOString();
  snapshotId = store.write(() =>
    insertSnapshot(store, {
      sourceId,
      status: 'complete',
      startedAt: at,
      finishedAt: at,
      engineVersion: 'bench',
      gitCommit: null,
    }),
  );
  const started = now();
  const written = writeAnalysis(store, snapshotId, {
    engineVersion: 'bench',
    analysedAt: at,
    components,
    work: ORIGIN.map((origin) => ({ origin, components: components.length, failedFiles: 0 })),
    issues: [],
  });
  const wroteIn = now() - started;
  store.checkpoint();
  result.write.push({
    snapshot: s,
    components: written.components,
    references,
    versions_added: written.versionsAdded,
    make_s: seconds(madeIn),
    write_s: seconds(wroteIn),
    rows_per_s: Math.round((written.components + references) / (wroteIn / 1000)),
    db_mb: megabytes(fs.statSync(file).size),
    changes,
  });
}
result.db_mb_first = result.write[0].db_mb;
result.db_mb_final = megabytes(fs.statSync(file).size);
result.write_first_s = result.write[0].write_s;
result.write_later_s =
  snapshots === 1
    ? null
    : +(result.write.slice(1).reduce((sum, one) => sum + one.write_s, 0) / (snapshots - 1)).toFixed(2);
result.rows = Object.fromEntries(
  ['component', 'component_version', 'reference', 'snapshot_component', 'file_path'].map((table) => [
    table,
    Number(store.get(`SELECT count(*) AS n FROM "${table}"`)?.n),
  ]),
);
result.table_mb = Object.fromEntries(
  store
    .all('SELECT name, sum(pgsize) AS bytes FROM dbstat GROUP BY name ORDER BY bytes DESC')
    .map((row) => [row.name, megabytes(Number(row.bytes))]),
);

// Reading through the interface of the engines, one statement per question. The hub is the field that most
// references of the last snapshot point at.
const inbound = new Int32Array(universe.N);
for (let j = 0; j < universe.M; j++) if (state.alive[universe.rsrc[j]]) inbound[universe.rdst[j]]++;
let hub = -1;
let leaf = -1;
for (const field of universe.fields) {
  if (!state.alive[field]) continue;
  if (hub < 0 || inbound[field] > inbound[hub]) hub = field;
  if (leaf < 0 && inbound[field] === 1) leaf = field;
}
const timed = (run, times = 5) => {
  const first = now();
  let value = run();
  const firstIn = now() - first;
  const all = [];
  for (let i = 0; i < times; i++) {
    const started = now();
    value = run();
    all.push(now() - started);
  }
  all.sort((a, b) => a - b);
  return { first_ms: +firstIn.toFixed(2), median_ms: +all[times >> 1].toFixed(2), result: value };
};
const graph = sqlGraph(store, snapshotId);
/** Everything that refers to the component within five steps, found one question at a time. */
const reach = (key) => {
  const start = graph.find(key);
  const seen = new Set([start.id]);
  let level = [start.id];
  for (let depth = 0; depth < 5 && level.length > 0; depth++) {
    const next = [];
    for (const id of level) {
      for (const reference of graph.referencesTo(id)) {
        if (!seen.has(reference.fromId)) {
          seen.add(reference.fromId);
          next.push(reference.fromId);
        }
      }
    }
    level = next;
  }
  return seen.size;
};
result.hub = { key: keys[hub], direct_inbound: inbound[hub] };
result.leaf = { key: keys[leaf], direct_inbound: inbound[leaf] };
result.find_hub = timed(() => graph.find(keys[hub]).key);
result.references_to_hub = timed(() => graph.referencesTo(graph.find(keys[hub]).id).length);
result.references_to_leaf = timed(() => graph.referencesTo(graph.find(keys[leaf]).id).length);
result.reach_hub_5_levels = timed(() => reach(keys[hub]), 3);
result.reach_leaf_5_levels = timed(() => reach(keys[leaf]));
store.close();

const text = JSON.stringify(result, null, 2);
if (outFile !== undefined) fs.writeFileSync(outFile, `${text}\n`);
console.log(text);
