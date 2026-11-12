/*
 * Downloads the public codebases listed in fixtures/corpora.toml into .corpora, each at its pinned commit.
 *
 *   node scripts/fetch-corpora.mjs            fetch every corpus
 *   node scripts/fetch-corpora.mjs npsp       fetch the named ones
 *   node scripts/fetch-corpora.mjs --list     print the manifest and fetch nothing
 *
 * A corpus that is already at its commit is left alone, so the script can run again at any time. Only the one
 * commit is downloaded, without history. Git must be installed. The script needs the network; no test does.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, rmSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parse } from 'smol-toml';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const target = join(root, '.corpora');

function fail(message) {
  console.error(message);
  process.exit(1);
}

/** Reads the manifest and refuses anything that could fetch something other than one pinned public commit. */
function readManifest(text) {
  const corpora = parse(text).corpus;
  if (!Array.isArray(corpora) || corpora.length === 0) throw new Error('corpora.toml lists no corpus.');
  const names = new Set();
  for (const corpus of corpora) {
    const { name, url, commit, licence, paths, use } = corpus;
    const where = `corpus "${String(name)}"`;
    if (typeof name !== 'string' || !/^[a-z0-9][a-z0-9-]*$/.test(name)) throw new Error(`${where}: bad name.`);
    if (names.has(name)) throw new Error(`${where}: listed twice.`);
    names.add(name);
    if (typeof url !== 'string' || !/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(url)) {
      throw new Error(`${where}: the url must be an https address of a GitHub repository, ending in .git.`);
    }
    if (typeof commit !== 'string' || !/^[0-9a-f]{40}$/.test(commit)) {
      throw new Error(`${where}: the commit must be a full commit id of 40 hexadecimal characters.`);
    }
    if (typeof licence !== 'string' || licence === '') throw new Error(`${where}: the licence is missing.`);
    if (typeof use !== 'string' || use === '') throw new Error(`${where}: the use is missing.`);
    if (!Array.isArray(paths) || paths.length === 0 || paths.some((path) => typeof path !== 'string')) {
      throw new Error(`${where}: paths must list at least one folder.`);
    }
    if (paths.some((path) => path.startsWith('/') || path.includes('\\') || path.split('/').includes('..'))) {
      throw new Error(`${where}: a path must stay inside the repository.`);
    }
    const unknown = Object.keys(corpus).filter(
      (key) => !['name', 'url', 'commit', 'licence', 'paths', 'use'].includes(key),
    );
    if (unknown.length > 0) throw new Error(`${where}: unknown key ${unknown.join(', ')}.`);
  }
  return corpora;
}

function git(cwd, args) {
  const result = spawnSync('git', args, { cwd, encoding: 'utf8' });
  if (result.error !== undefined) fail(`Git could not be started: ${result.error.message}`);
  return { ok: result.status === 0, out: result.stdout.trim(), err: result.stderr.trim() };
}

function fetchCorpus(corpus) {
  const dir = join(target, corpus.name);
  if (existsSync(join(dir, '.git')) && git(dir, ['rev-parse', 'HEAD']).out === corpus.commit) {
    console.log(`${corpus.name}: already at ${corpus.commit.slice(0, 12)}`);
    return;
  }
  rmSync(dir, { recursive: true, force: true, maxRetries: 5, retryDelay: 100 });
  mkdirSync(dir, { recursive: true });
  const steps = [
    ['init', '--quiet'],
    ['remote', 'add', 'origin', corpus.url],
    // Line endings stay as the repository has them, on every system.
    ['config', 'core.autocrlf', 'false'],
    ['fetch', '--quiet', '--depth', '1', 'origin', corpus.commit],
    ['checkout', '--quiet', '--detach', 'FETCH_HEAD'],
  ];
  for (const step of steps) {
    const result = git(dir, step);
    if (!result.ok) fail(`${corpus.name}: git ${step[0]} failed.\n${result.err}`);
  }
  const head = git(dir, ['rev-parse', 'HEAD']).out;
  if (head !== corpus.commit) fail(`${corpus.name}: fetched ${head}, expected ${corpus.commit}.`);
  const missing = corpus.paths.filter((path) => !existsSync(join(dir, path)));
  if (missing.length > 0) fail(`${corpus.name}: the commit has no folder ${missing.join(', ')}.`);
  console.log(`${corpus.name}: fetched ${corpus.commit.slice(0, 12)} (${corpus.licence})`);
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  let corpora;
  try {
    corpora = readManifest(readFileSync(join(root, 'fixtures/corpora.toml'), 'utf8'));
  } catch (error) {
    fail(`fixtures/corpora.toml: ${error.message}`);
  }
  const args = process.argv.slice(2);
  if (args.includes('--list')) {
    for (const corpus of corpora) console.log(`${corpus.name}  ${corpus.commit}  ${corpus.licence}  ${corpus.url}`);
  } else {
    const unknown = args.filter((name) => !corpora.some((corpus) => corpus.name === name));
    if (unknown.length > 0) fail(`No corpus named ${unknown.join(', ')}. Run with --list to see the names.`);
    for (const corpus of corpora) {
      if (args.length === 0 || args.includes(corpus.name)) fetchCorpus(corpus);
    }
  }
}
