import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { ForceIgnore } from '@salesforce/source-deploy-retrieve';
import { afterEach, describe, expect, it } from 'vitest';
import { DEFAULT_RULES, FORCEIGNORE_FILE, ignoreFileCandidates, ignoreRules } from '../src/sources/forceignore.ts';
import { tempDirs } from './helpers/store.ts';

const temp = tempDirs();
afterEach(temp.cleanUp);

const rules = (at: string, content: string): ((path: string) => boolean) =>
  ignoreRules(at, new TextEncoder().encode(content));

describe('.forceignore', () => {
  it('starts from the same default rules as the Salesforce library', () => {
    const library = new ForceIgnore() as unknown as { DEFAULT_IGNORE: string[] };
    expect(DEFAULT_RULES).toEqual(library.DEFAULT_IGNORE);
  });

  it('evaluates the rules with the very copy of the "ignore" package the Salesforce library uses', () => {
    // The two would drift apart silently if an upgrade of one of them brought another version of the package.
    const engine = createRequire(new URL('../src/sources/forceignore.ts', import.meta.url));
    const library = createRequire(engine.resolve('@salesforce/source-deploy-retrieve'));
    expect(realpathSync(engine.resolve('ignore'))).toBe(realpathSync(library.resolve('ignore')));
  });

  it('looks for the file in the folder first, then in every folder above it up to the root of the source', () => {
    expect(ignoreFileCandidates('packages/core/app')).toEqual([
      'packages/core/app/.forceignore',
      'packages/core/.forceignore',
      'packages/.forceignore',
      '.forceignore',
    ]);
    expect(ignoreFileCandidates('force-app')).toEqual(['force-app/.forceignore', '.forceignore']);
  });

  it('excludes what the file names, with the patterns of .gitignore', () => {
    const excluded = rules(
      '.forceignore',
      ['# a comment', '**/profiles/**', 'force-app/main/default/classes/Legacy*', '*.bak', 'build/', '!keep.bak'].join(
        '\n',
      ),
    );
    expect(excluded('force-app/main/default/profiles/Admin.profile-meta.xml')).toBe(true);
    expect(excluded('force-app/main/default/classes/LegacyService.cls')).toBe(true);
    expect(excluded('force-app/main/default/classes/Service.cls')).toBe(false);
    expect(excluded('force-app/x/old.bak')).toBe(true);
    expect(excluded('force-app/x/keep.bak')).toBe(false);
    // A pattern that ends with a slash names a folder: what is in it is excluded, a file of that name is not.
    expect(excluded('force-app/build/out.cls')).toBe(true);
    expect(excluded('force-app/classes/build')).toBe(false);
  });

  it('applies the default rules as soon as there is a file, also an empty one', () => {
    const excluded = rules('.forceignore', '');
    expect(excluded('force-app/main/default/classes/.hidden')).toBe(true);
    expect(excluded('force-app/main/default/lwc/.eslintrc.json')).toBe(true);
    expect(excluded('force-app/main/default/classes/A.cls.dup')).toBe(true);
    expect(excluded('force-app/package2-descriptor.json')).toBe(true);
    expect(excluded('force-app/main/default/classes/A.cls')).toBe(false);
  });

  it('reads the patterns of a file in a folder as relative to that folder, and leaves other folders alone', () => {
    const excluded = rules('packages/core/.forceignore', 'app/classes/Skip.cls\n/root-only.cls');
    expect(excluded('packages/core/app/classes/Skip.cls')).toBe(true);
    expect(excluded('packages/core/root-only.cls')).toBe(true);
    expect(excluded('packages/core/app/root-only.cls')).toBe(false);
    expect(excluded('packages/other/app/classes/Skip.cls')).toBe(false);
    expect(excluded('app/classes/Skip.cls')).toBe(false);
    expect(excluded('packages/core')).toBe(false);
  });

  it('decides about files on disk as the Salesforce library does', () => {
    const root = temp.next();
    const content = [
      '**/profiles/**',
      'force-app/main/default/classes/Legacy*',
      '*.bak',
      '**/__tests__/**',
      '!**/classes/LegacyKeep.cls',
      'force-app/main/default/objects/Invoice__c/fields/Secret__c.field-meta.xml',
      '**/jsconfig.json',
    ].join('\n');
    const files = [
      'force-app/main/default/profiles/Admin.profile-meta.xml',
      'force-app/main/default/classes/LegacyService.cls',
      'force-app/main/default/classes/LegacyService.cls-meta.xml',
      'force-app/main/default/classes/LegacyKeep.cls',
      'force-app/main/default/classes/Service.cls',
      'force-app/main/default/classes/Service.cls.bak',
      'force-app/main/default/classes/.hidden',
      'force-app/main/default/lwc/tile/tile.js',
      'force-app/main/default/lwc/tile/__tests__/tile.test.js',
      'force-app/main/default/lwc/jsconfig.json',
      'force-app/main/default/objects/Invoice__c/fields/Secret__c.field-meta.xml',
      'force-app/main/default/objects/Invoice__c/fields/Open__c.field-meta.xml',
      'force-app/main/default/classes/Copy.cls.dup',
    ];
    writeFileSync(join(root, FORCEIGNORE_FILE), content);
    for (const file of files) {
      mkdirSync(join(root, ...file.split('/'), '..'), { recursive: true });
      writeFileSync(join(root, ...file.split('/')), '');
    }
    const library = new ForceIgnore(join(root, FORCEIGNORE_FILE));
    const excluded = rules(FORCEIGNORE_FILE, content);
    const mine = files.filter(excluded);
    expect(mine).toEqual(files.filter((file) => library.denies(join(root, ...file.split('/')))));
    // The comparison means something only if some files are excluded and some are not.
    expect(mine.length).toBeGreaterThan(5);
    expect(mine.length).toBeLessThan(files.length - 3);
  });
});
