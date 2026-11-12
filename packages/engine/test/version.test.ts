import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { afterEach, describe, expect, it } from 'vitest';
import { readPackageVersion } from '../src/core/version.ts';

describe('readPackageVersion', () => {
  const dirs: string[] = [];
  const manifest = (content: string): URL => {
    const dir = mkdtempSync(join(tmpdir(), 'orglens-version-'));
    dirs.push(dir);
    const file = join(dir, 'package.json');
    writeFileSync(file, content);
    return pathToFileURL(file);
  };

  afterEach(() => {
    for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true });
  });

  it('returns the version field', () => {
    expect(readPackageVersion(manifest('{"name":"x","version":"1.2.3"}'))).toBe('1.2.3');
  });

  it.each(['{"name":"x"}', '{"version":1}', 'null', '[]'])('rejects a manifest without a version: %s', (content) => {
    expect(() => readPackageVersion(manifest(content))).toThrow(/No version field/);
  });
});
