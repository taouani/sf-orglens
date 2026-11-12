/*
 * Benchmark of storage layouts for the workspace database, on a synthetic org.
 *
 *   node bench/bench.mjs [driver] [layout] [snapshots] [--out file.json]
 *
 *   driver     node (the SQLite built into Node.js, default) or bs3 (better-sqlite3)
 *   layout     cas (shared versions, default), int (full copy per snapshot, integer ids) or
 *              text (full copy per snapshot, text keys)
 *   snapshots  how many snapshots to load, default 2
 *
 * It builds the database in a temporary folder, prints the measurements as JSON and removes the folder.
 * The layouts are the ones compared in docs/research/phase-0/sqlite-store.md.
 */
import fs from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';
import { buildUniverse, initialState, evolve, contentHash } from './generate.mjs';

const args = process.argv.slice(2);
const outAt = args.indexOf('--out');
const outFile = outAt === -1 ? undefined : args.splice(outAt, 2)[1];
const [driver = 'node', schema = 'cas', snapsArg = '2'] = args;
if (!['node', 'bs3'].includes(driver) || !['cas', 'int', 'text'].includes(schema) || !(Number(snapsArg) >= 1)) {
  console.error('usage: node bench/bench.mjs [node|bs3] [cas|int|text] [snapshots] [--out file.json]');
  process.exit(2);
}
const K = Number(snapsArg);
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'orglens-bench-'));
const file = path.join(dir, `bench-${driver}-${schema}-${String(K)}.sqlite`);
let db, raw;
if (driver === 'node') {
  const { DatabaseSync } = await import('node:sqlite');
  db = new DatabaseSync(file);
  raw = (st) => {
    st.setReturnArrays(true);
    return st;
  };
} else {
  // The fallback driver is a development dependency of the engine package.
  const require = createRequire(new URL('../packages/engine/package.json', import.meta.url));
  const Database = require('better-sqlite3');
  db = new Database(file);
  raw = (st) => st.raw(true);
}
const now = () => Number(process.hrtime.bigint()) / 1e6;
const tx = (fn) => {
  db.exec('BEGIN IMMEDIATE');
  try {
    fn();
    db.exec('COMMIT');
  } catch (e) {
    db.exec('ROLLBACK');
    throw e;
  }
};
const timed = (fn, n = 5) => {
  const t0 = now();
  let res = fn();
  const first = now() - t0;
  const ts = [];
  for (let i = 0; i < n; i++) {
    const t = now();
    res = fn();
    ts.push(now() - t);
  }
  ts.sort((a, b) => a - b);
  return { first_ms: +first.toFixed(2), median_ms: +ts[n >> 1].toFixed(2), result: res };
};
db.exec('PRAGMA journal_mode=WAL; PRAGMA synchronous=NORMAL; PRAGMA cache_size=-64000; PRAGMA temp_store=MEMORY;');
const R = {
  driver,
  schema,
  snapshots: K,
  node: process.version,
  sqlite: db.prepare('select sqlite_version() v').get().v,
  load: [],
};
const u = buildUniverse();
const st = initialState(u);
const BASE = 1_000_000; // component id = snapshot*BASE + nodeIndex (stands in for a key->id map)

if (schema === 'int')
  db.exec(`
 CREATE TABLE snapshot(id INTEGER PRIMARY KEY, created_at TEXT, n_components INTEGER, n_references INTEGER);
 CREATE TABLE component(id INTEGER PRIMARY KEY, snapshot_id INTEGER NOT NULL, key TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, parent_id INTEGER, path TEXT, attrs TEXT, content_hash BLOB NOT NULL);
 CREATE UNIQUE INDEX component_snap_key ON component(snapshot_id, key);
 CREATE INDEX component_snap_type ON component(snapshot_id, type, name);
 CREATE TABLE reference(snapshot_id INTEGER NOT NULL, src INTEGER NOT NULL, dst INTEGER NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL, confidence REAL NOT NULL, file_id INTEGER, line INTEGER);
 CREATE INDEX reference_dst ON reference(snapshot_id, dst, src);
 CREATE INDEX reference_src ON reference(snapshot_id, src);
 CREATE VIRTUAL TABLE fts_tri USING fts5(name, content='component', content_rowid='id', tokenize='trigram');
 CREATE VIRTUAL TABLE fts_uni USING fts5(name, content='component', content_rowid='id', tokenize="unicode61 tokenchars '_'", prefix='2 3');
`);
if (schema === 'text')
  db.exec(`
 CREATE TABLE snapshot(id INTEGER PRIMARY KEY, created_at TEXT, n_components INTEGER, n_references INTEGER);
 CREATE TABLE component(key TEXT NOT NULL, type TEXT NOT NULL, name TEXT NOT NULL, snapshot_id INTEGER NOT NULL, attrs TEXT, content_hash TEXT NOT NULL, PRIMARY KEY(snapshot_id, key)) WITHOUT ROWID;
 CREATE INDEX component_snap_type ON component(snapshot_id, type, name);
 CREATE TABLE reference(src TEXT NOT NULL, dst TEXT NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL, confidence REAL NOT NULL, file TEXT, line INTEGER, snapshot_id INTEGER NOT NULL);
 CREATE INDEX reference_dst ON reference(snapshot_id, dst, src);
 CREATE INDEX reference_src ON reference(snapshot_id, src);
 CREATE VIRTUAL TABLE fts_tri USING fts5(name, key UNINDEXED, snapshot_id UNINDEXED, tokenize='trigram');
`);
if (schema === 'cas')
  db.exec(`
 CREATE TABLE snapshot(id INTEGER PRIMARY KEY, created_at TEXT, n_components INTEGER, n_references INTEGER);
 CREATE TABLE node(id INTEGER PRIMARY KEY, key TEXT NOT NULL UNIQUE, type TEXT NOT NULL, name TEXT NOT NULL, parent_id INTEGER, path TEXT);
 CREATE TABLE version(id INTEGER PRIMARY KEY, node_id INTEGER NOT NULL, content_hash BLOB NOT NULL, attrs TEXT);
 CREATE UNIQUE INDEX version_node_hash ON version(node_id, content_hash);
 CREATE TABLE snapshot_item(snapshot_id INTEGER NOT NULL, node_id INTEGER NOT NULL, version_id INTEGER NOT NULL, PRIMARY KEY(snapshot_id, node_id)) WITHOUT ROWID;
 CREATE UNIQUE INDEX snapshot_item_ver ON snapshot_item(snapshot_id, version_id, node_id);
 CREATE TABLE reference(src_version INTEGER NOT NULL, dst_node INTEGER NOT NULL, kind TEXT NOT NULL, origin TEXT NOT NULL, confidence REAL NOT NULL, line INTEGER);
 CREATE INDEX reference_dst ON reference(dst_node, src_version);
 CREATE INDEX reference_src ON reference(src_version);
 CREATE VIRTUAL TABLE fts_tri USING fts5(name, content='node', content_rowid='id', tokenize='trigram');
`);

// ---------- load K snapshots ----------
const nodeSeen = new Uint8Array(u.N),
  curVersion = new Int32Array(u.N),
  curVerNo = new Int32Array(u.N).fill(-1);
let nextVersion = 1;
for (let s = 1; s <= K; s++) {
  const ev = s > 1 ? evolve(u, st) : null;
  const { alive, ver } = st;
  let nc = 0,
    nr = 0;
  const t0 = now();
  let tFts = 0;
  tx(() => {
    if (schema === 'int') {
      const ic = db.prepare(
        'INSERT INTO component(id,snapshot_id,key,type,name,parent_id,path,attrs,content_hash) VALUES (?,?,?,?,?,?,?,?,?)',
      );
      const ir = db.prepare(
        'INSERT INTO reference(snapshot_id,src,dst,kind,origin,confidence,file_id,line) VALUES (?,?,?,?,?,?,?,?)',
      );
      const b = s * BASE;
      for (let i = 0; i < u.N; i++)
        if (alive[i]) {
          ic.run(
            b + i,
            s,
            u.key[i],
            u.type[i],
            u.name[i],
            u.parent[i] >= 0 ? b + u.parent[i] : null,
            u.path[i],
            u.attrs(i),
            contentHash(u, i, ver[i]),
          );
          nc++;
        }
      for (let j = 0; j < u.M; j++) {
        const a = u.rsrc[j],
          d = u.rdst[j];
        if (alive[a] && alive[d]) {
          ir.run(s, b + a, b + d, u.KIND[u.rkind[j]], u.ORIGIN[u.rorigin[j]], u.rconf[j], b + u.top[a], u.rline[j]);
          nr++;
        }
      }
      const tf = now();
      db.prepare(`INSERT INTO fts_tri(rowid,name) SELECT id,name FROM component WHERE snapshot_id=?`).run(s);
      db.prepare(`INSERT INTO fts_uni(rowid,name) SELECT id,name FROM component WHERE snapshot_id=?`).run(s);
      tFts = now() - tf;
    } else if (schema === 'text') {
      const ic = db.prepare('INSERT INTO component(key,type,name,snapshot_id,attrs,content_hash) VALUES (?,?,?,?,?,?)');
      const ir = db.prepare(
        'INSERT INTO reference(src,dst,kind,origin,confidence,file,line,snapshot_id) VALUES (?,?,?,?,?,?,?,?)',
      );
      for (let i = 0; i < u.N; i++)
        if (alive[i]) {
          ic.run(u.key[i], u.type[i], u.name[i], s, u.attrs(i), contentHash(u, i, ver[i]).toString('hex'));
          nc++;
        }
      for (let j = 0; j < u.M; j++) {
        const a = u.rsrc[j],
          d = u.rdst[j];
        if (alive[a] && alive[d]) {
          ir.run(
            u.key[a],
            u.key[d],
            u.KIND[u.rkind[j]],
            u.ORIGIN[u.rorigin[j]],
            u.rconf[j],
            u.path[u.top[a]],
            u.rline[j],
            s,
          );
          nr++;
        }
      }
      const tf = now();
      db.prepare(
        `INSERT INTO fts_tri(name,key,snapshot_id) SELECT name,key,snapshot_id FROM component WHERE snapshot_id=?`,
      ).run(s);
      tFts = now() - tf;
    } else {
      const inode = db.prepare('INSERT INTO node(id,key,type,name,parent_id,path) VALUES (?,?,?,?,?,?)');
      const iver = db.prepare('INSERT INTO version(id,node_id,content_hash,attrs) VALUES (?,?,?,?)');
      const iitem = db.prepare('INSERT INTO snapshot_item(snapshot_id,node_id,version_id) VALUES (?,?,?)');
      const ir = db.prepare(
        'INSERT INTO reference(src_version,dst_node,kind,origin,confidence,line) VALUES (?,?,?,?,?,?)',
      );
      const ifts = db.prepare('INSERT INTO fts_tri(rowid,name) VALUES (?,?)');
      for (let i = 0; i < u.N; i++)
        if (alive[i]) {
          if (!nodeSeen[i]) {
            inode.run(i + 1, u.key[i], u.type[i], u.name[i], u.parent[i] >= 0 ? u.parent[i] + 1 : null, u.path[i]);
            ifts.run(i + 1, u.name[i]);
            nodeSeen[i] = 1;
          }
          if (curVerNo[i] !== ver[i]) {
            const v = nextVersion++;
            iver.run(v, i + 1, contentHash(u, i, ver[i]), u.attrs(i));
            curVersion[i] = v;
            curVerNo[i] = ver[i];
            for (let p = u.srcStart[i]; p < u.srcStart[i + 1]; p++) {
              const j = u.srcRefs[p];
              ir.run(v, u.rdst[j] + 1, u.KIND[u.rkind[j]], u.ORIGIN[u.rorigin[j]], u.rconf[j], u.rline[j]);
              nr++;
            }
          }
          iitem.run(s, i + 1, curVersion[i]);
          nc++;
        }
    }
    db.prepare('INSERT INTO snapshot(id,created_at,n_components,n_references) VALUES (?,?,?,?)').run(
      s,
      new Date().toISOString(),
      nc,
      nr,
    );
  });
  const ms = now() - t0;
  db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
  R.load.push({
    snapshot: s,
    components: nc,
    references_inserted: nr,
    total_ms: Math.round(ms),
    fts_ms: Math.round(tFts),
    rows_per_s: Math.round((nc + nr) / ((ms - tFts) / 1000)),
    db_mb: +(fs.statSync(file).size / 1048576).toFixed(1),
    evolve: ev,
  });
}
db.exec('ANALYZE');
R.db_mb_final = +(fs.statSync(file).size / 1048576).toFixed(1);
R.table_mb = Object.fromEntries(
  db
    .prepare('SELECT name, sum(pgsize) b FROM dbstat GROUP BY name ORDER BY b DESC')
    .all()
    .map((r) => [r.name, +(r.b / 1048576).toFixed(1)]),
);

// ---------- pick hub / leaf in latest snapshot ----------
const S = K,
  b = S * BASE;
const { alive } = st;
const indeg = new Int32Array(u.N);
for (let j = 0; j < u.M; j++) if (alive[u.rsrc[j]] && alive[u.rdst[j]]) indeg[u.rdst[j]]++;
let hub = -1,
  leaf = -1;
for (const f of u.fields) {
  if (!alive[f]) continue;
  if (hub < 0 || indeg[f] > indeg[hub]) hub = f;
  if (leaf < 0 && indeg[f] === 1) leaf = f;
}
R.hub = { key: u.key[hub], direct_inbound: indeg[hub] };
R.leaf = { key: u.key[leaf], direct_inbound: indeg[leaf] };
const idOf = (i) => (schema === 'int' ? b + i : schema === 'text' ? u.key[i] : i + 1);

// ---------- recursive CTE impact (depth 5, inbound) ----------
const impactSql = {
  int: `WITH RECURSIVE impact(id, depth) AS (SELECT :p1, 0 UNION SELECT r.src, i.depth+1 FROM impact i JOIN reference r ON r.snapshot_id=:p2 AND r.dst=i.id WHERE i.depth < :p3)
        SELECT id, min(depth) d FROM impact GROUP BY id`,
  text: `WITH RECURSIVE impact(id, depth) AS (SELECT :p1, 0 UNION SELECT r.src, i.depth+1 FROM impact i JOIN reference r ON r.snapshot_id=:p2 AND r.dst=i.id WHERE i.depth < :p3)
        SELECT id, min(depth) d FROM impact GROUP BY id`,
  cas: `WITH RECURSIVE impact(id, depth) AS (SELECT :p1, 0 UNION SELECT s.node_id, i.depth+1 FROM impact i JOIN reference r ON r.dst_node=i.id JOIN snapshot_item s ON s.snapshot_id=:p2 AND s.version_id=r.src_version WHERE i.depth < :p3)
        SELECT id, min(depth) d FROM impact GROUP BY id`,
}[schema];
const impact = raw(db.prepare(impactSql));
const summarize = (rows) => {
  const by = [0, 0, 0, 0, 0, 0];
  for (const r of rows) by[r[1]]++;
  return { reached: rows.length, by_depth: by.join('/') };
};
R.cte_hub_d5 = timed(() => summarize(impact.all({ p1: idOf(hub), p2: S, p3: 5 })));
R.cte_leaf_d5 = timed(() => summarize(impact.all({ p1: idOf(leaf), p2: S, p3: 5 })));
R.cte_hub_d1 = timed(() => summarize(impact.all({ p1: idOf(hub), p2: S, p3: 1 })));
// full-detail result: join impacted ids back to component rows (what a CLI would print)
if (schema === 'int') {
  const q = db.prepare(
    `WITH RECURSIVE impact(id, depth) AS (SELECT :p1, 0 UNION SELECT r.src, i.depth+1 FROM impact i JOIN reference r ON r.snapshot_id=:p2 AND r.dst=i.id WHERE i.depth < :p3) SELECT c.key, c.type, min(i.depth) d FROM impact i JOIN component c ON c.id=i.id GROUP BY i.id`,
  );
  R.cte_hub_d5_with_keys = timed(() => q.all({ p1: b + hub, p2: S, p3: 5 }).length, 3);
}
// unbounded transitive closure with id-only dedup (no depth column)
{
  const sql = {
    int: `WITH RECURSIVE impact(id) AS (SELECT :p1 UNION SELECT r.src FROM impact i JOIN reference r ON r.snapshot_id=:p2 AND r.dst=i.id) SELECT count(*) c FROM impact`,
    cas: `WITH RECURSIVE impact(id) AS (SELECT :p1 UNION SELECT s.node_id FROM impact i JOIN reference r ON r.dst_node=i.id JOIN snapshot_item s ON s.snapshot_id=:p2 AND s.version_id=r.src_version) SELECT count(*) c FROM impact`,
  };
  sql.text = sql.int;
  const q = db.prepare(sql[schema]);
  R.cte_hub_unbounded_idonly = timed(() => q.get({ p1: idOf(hub), p2: S }).c, 3);
}
// JSON function filter over one snapshot
{
  const sql = {
    int: `SELECT count(*) c FROM component WHERE snapshot_id=:p2 AND type='ApexMethod' AND json_extract(attrs,'$.static')=1`,
    text: `SELECT count(*) c FROM component WHERE snapshot_id=:p2 AND type='ApexMethod' AND json_extract(attrs,'$.static')=1`,
    cas: `SELECT count(*) c FROM snapshot_item s JOIN version v ON v.id=s.version_id JOIN node n ON n.id=s.node_id WHERE s.snapshot_id=:p2 AND n.type='ApexMethod' AND json_extract(v.attrs,'$.static')=1`,
  }[schema];
  const q = db.prepare(sql);
  R.json_filter = timed(() => q.get({ p2: S }).c, 3);
}
// direct inbound listing with file + line
const directSql = {
  int: `SELECT c.key, r.kind, r.origin, r.confidence, f.path, r.line FROM reference r JOIN component c ON c.id=r.src LEFT JOIN component f ON f.id=r.file_id WHERE r.snapshot_id=:p2 AND r.dst=:p1`,
  text: `SELECT src, kind, origin, confidence, file, line FROM reference WHERE snapshot_id=:p2 AND dst=:p1`,
  cas: `SELECT n.key, r.kind, r.origin, r.confidence, r.line FROM reference r JOIN snapshot_item s ON s.snapshot_id=:p2 AND s.version_id=r.src_version JOIN node n ON n.id=s.node_id WHERE r.dst_node=:p1`,
}[schema];
const direct = db.prepare(directSql);
R.direct_inbound_hub = timed(() => direct.all({ p1: idOf(hub), p2: S }).length);
R.direct_inbound_leaf = timed(() => direct.all({ p1: idOf(leaf), p2: S }).length);

// ---------- in-memory adjacency + BFS ----------
{
  const adjSql = {
    int: `SELECT dst, src FROM reference WHERE snapshot_id=?`,
    text: null,
    cas: `SELECT r.dst_node, s.node_id FROM snapshot_item s JOIN reference r ON r.src_version=s.version_id WHERE s.snapshot_id=?`,
  }[schema];
  if (adjSql) {
    const q = raw(db.prepare(adjSql));
    const off = schema === 'int' ? b : 1;
    const h0 = process.memoryUsage();
    const t0 = now();
    const rows = q.all(S);
    const tQuery = now() - t0;
    const t1 = now();
    const n = u.N + 1;
    const start = new Int32Array(n + 1);
    for (const r of rows) start[r[0] - off + 1]++;
    for (let i = 0; i < n; i++) start[i + 1] += start[i];
    const adj = new Int32Array(rows.length);
    const pos = start.slice(0, n);
    for (const r of rows) adj[pos[r[0] - off]++] = r[1] - off;
    const tBuild = now() - t1;
    // streaming variant (no intermediate row array)
    const t2 = now();
    let streamed = 0;
    for (const row of q.iterate(S)) if (row) streamed++;
    const tIter = now() - t2;
    if (streamed !== rows.length) throw new Error('the streaming read and the full read disagree');
    const bfs = (root, maxDepth) => {
      const depth = new Int8Array(n).fill(-1);
      let frontier = [root];
      depth[root] = 0;
      let reached = 1;
      const by = new Array(Math.min(maxDepth, 12) + 1).fill(0);
      by[0] = 1;
      for (let d = 1; d <= maxDepth && frontier.length; d++) {
        const next = [];
        for (const x of frontier)
          for (let p = start[x]; p < start[x + 1]; p++) {
            const y = adj[p];
            if (depth[y] < 0) {
              depth[y] = d;
              next.push(y);
              reached++;
              if (d < by.length) by[d]++;
            }
          }
        frontier = next;
      }
      return { reached, by_depth: by.join('/') };
    };
    const h1 = process.memoryUsage();
    R.mem_adjacency = {
      edges: rows.length,
      query_all_ms: +tQuery.toFixed(1),
      build_csr_ms: +tBuild.toFixed(1),
      iterate_ms: +tIter.toFixed(1),
      csr_bytes_mb: +((start.byteLength + adj.byteLength) / 1048576).toFixed(2),
      rss_delta_mb: +((h1.rss - h0.rss) / 1048576).toFixed(1),
      bfs_hub_d5: timed(() => bfs(hub + (schema === 'int' ? 0 : 0), 5)),
      bfs_leaf_d5: timed(() => bfs(leaf, 5)),
      bfs_hub_unbounded: timed(() => bfs(hub, 127)),
    };
  }
}
// ---------- FTS ----------
{
  const ftsSql = {
    int: `SELECT c.key FROM fts_tri f JOIN component c ON c.id=f.rowid WHERE fts_tri MATCH :p1 AND c.snapshot_id=:p2 LIMIT 50`,
    text: `SELECT key FROM fts_tri WHERE fts_tri MATCH :p1 AND snapshot_id=:p2 LIMIT 50`,
    cas: `SELECT n.key FROM fts_tri f JOIN node n ON n.id=f.rowid JOIN snapshot_item s ON s.snapshot_id=:p2 AND s.node_id=n.id WHERE fts_tri MATCH :p1 LIMIT 50`,
  }[schema];
  const cntSql = {
    int: `SELECT count(*) c FROM fts_tri f JOIN component c ON c.id=f.rowid WHERE fts_tri MATCH :p1 AND c.snapshot_id=:p2`,
    text: `SELECT count(*) c FROM fts_tri WHERE fts_tri MATCH :p1 AND snapshot_id=:p2`,
    cas: `SELECT count(*) c FROM fts_tri f JOIN snapshot_item s ON s.snapshot_id=:p2 AND s.node_id=f.rowid WHERE fts_tri MATCH :p1`,
  }[schema];
  const q = db.prepare(ftsSql),
    c = db.prepare(cntSql);
  R.fts = {};
  for (const term of ['Billing', 'TriggerHandler', 'calculateRenewalAmount', 'enew'])
    R.fts['trigram:' + term] = {
      top50: timed(() => q.all({ p1: term, p2: S }).length),
      count_all: timed(() => c.get({ p1: term, p2: S }).c, 3),
    };
  if (schema === 'int') {
    const p = db.prepare(
      `SELECT c.key FROM fts_uni f JOIN component c ON c.id=f.rowid WHERE fts_uni MATCH :p1 AND c.snapshot_id=:p2 LIMIT 50`,
    );
    for (const term of ['acc*', 'billing_number*'])
      R.fts['unicode61:' + term] = { top50: timed(() => p.all({ p1: term, p2: S }).length) };
  }
  const like = {
    int: `SELECT key FROM component WHERE snapshot_id=:p2 AND name LIKE :p1 LIMIT 50`,
    text: `SELECT key FROM component WHERE snapshot_id=:p2 AND name LIKE :p1 LIMIT 50`,
    cas: `SELECT key FROM node WHERE name LIKE :p1 LIMIT 50`,
  }[schema];
  const lq = db.prepare(like);
  R.fts['LIKE:%calculateRenewalAmount%'] = {
    top50: timed(
      () =>
        (schema === 'cas'
          ? lq.all({ p1: '%calculateRenewalAmount%' })
          : lq.all({ p1: '%calculateRenewalAmount%', p2: S })
        ).length,
      3,
    ),
  };
}
// ---------- diff of two snapshots ----------
if (K >= 2) {
  const A = K - 1,
    B = K;
  const d = {
    int: [
      `SELECT a.key FROM component a JOIN component b ON b.snapshot_id=:p2 AND b.key=a.key WHERE a.snapshot_id=:p1 AND a.content_hash<>b.content_hash`,
      `SELECT b.key FROM component b WHERE b.snapshot_id=:p2 AND NOT EXISTS (SELECT 1 FROM component a WHERE a.snapshot_id=:p1 AND a.key=b.key)`,
      `SELECT a.key FROM component a WHERE a.snapshot_id=:p1 AND NOT EXISTS (SELECT 1 FROM component b WHERE b.snapshot_id=:p2 AND b.key=a.key)`,
    ],
    cas: [
      `SELECT a.node_id FROM snapshot_item a JOIN snapshot_item b ON b.snapshot_id=:p2 AND b.node_id=a.node_id WHERE a.snapshot_id=:p1 AND a.version_id<>b.version_id`,
      `SELECT b.node_id FROM snapshot_item b WHERE b.snapshot_id=:p2 AND NOT EXISTS (SELECT 1 FROM snapshot_item a WHERE a.snapshot_id=:p1 AND a.node_id=b.node_id)`,
      `SELECT a.node_id FROM snapshot_item a WHERE a.snapshot_id=:p1 AND NOT EXISTS (SELECT 1 FROM snapshot_item b WHERE b.snapshot_id=:p2 AND b.node_id=a.node_id)`,
    ],
  };
  d.text = d.int;
  const qs = d[schema].map((s) => db.prepare(s));
  R.diff = timed(() => ({
    changed: qs[0].all({ p1: A, p2: B }).length,
    added: qs[1].all({ p1: A, p2: B }).length,
    removed: qs[2].all({ p1: A, p2: B }).length,
  }));
}
// ---------- delete oldest snapshot (retention) ----------
if (K >= 2 && schema !== 'text') {
  const t0 = now();
  tx(() => {
    if (schema === 'int') {
      db.exec(
        `INSERT INTO fts_tri(fts_tri, rowid, name) SELECT 'delete', id, name FROM component WHERE snapshot_id=1; INSERT INTO fts_uni(fts_uni, rowid, name) SELECT 'delete', id, name FROM component WHERE snapshot_id=1; DELETE FROM reference WHERE snapshot_id=1; DELETE FROM component WHERE snapshot_id=1; DELETE FROM snapshot WHERE id=1;`,
      );
    } else {
      db.exec(`DELETE FROM snapshot_item WHERE snapshot_id=1; DELETE FROM snapshot WHERE id=1;
      CREATE TEMP TABLE dead AS SELECT v.id FROM version v WHERE NOT EXISTS (SELECT 1 FROM snapshot_item s WHERE s.version_id=v.id);
      DELETE FROM reference WHERE src_version IN (SELECT id FROM dead); DELETE FROM version WHERE id IN (SELECT id FROM dead); DROP TABLE dead;`);
    }
  });
  R.delete_oldest_snapshot_ms = Math.round(now() - t0);
}
R.query_plans = {
  impact: db
    .prepare('EXPLAIN QUERY PLAN ' + impactSql)
    .all({ p1: idOf(hub), p2: S, p3: 5 })
    .map((r) => r.detail),
};
db.close();
fs.rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
console.log(JSON.stringify(R, null, 1));
if (outFile) fs.writeFileSync(outFile, `${JSON.stringify(R, null, 1)}\n`);
