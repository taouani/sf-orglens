/**
 * Draws a sample of the references a run found, for a check by hand: each one with its line of source.
 *
 *   node trial/apex/src/sample.ts <result of run-corpus.ts as JSON> <folder of the codebase> <how many> <seed>
 *
 * The same seed gives the same sample.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { Found } from './resolver.ts';

const [resultFile, root, howMany, seedText] = process.argv.slice(2);
if (resultFile === undefined || root === undefined)
  throw new Error('Usage: sample.ts <result> <folder> <how many> <seed>');
const result = JSON.parse(readFileSync(resultFile, 'utf8')) as { references: Found[] };

/** A small generator of random numbers with a seed (mulberry32). */
function random(seed: number): () => number {
  let state = seed >>> 0;
  return () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const next = random(Number(seedText ?? '1'));
const pool = [...result.references];
const sample: Found[] = [];
const wanted = Math.min(Number(howMany ?? '100'), pool.length);
while (sample.length < wanted) {
  const [picked] = pool.splice(Math.floor(next() * pool.length), 1);
  if (picked !== undefined) sample.push(picked);
}
sample.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line || a.column - b.column);
const lines = new Map<string, string[]>();
sample.forEach((found, index) => {
  let text = lines.get(found.file);
  if (text === undefined) {
    text = readFileSync(join(root, found.file), 'utf8').replaceAll('\r\n', '\n').split('\n');
    lines.set(found.file, text);
  }
  const short = found.file.split('/').at(-1) ?? found.file;
  console.log(
    `${String(index + 1)}. ${short}:${String(found.line)}:${String(found.column)} ${found.match} | ${found.kind} ${found.to} | ${found.via} ${found.tier}${found.op === undefined ? '' : ` ${found.op}`} | from ${found.from}`,
  );
  console.log(`     ${(text[found.line - 1] ?? '').trim()}`);
});
