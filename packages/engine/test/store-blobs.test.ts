import { randomBytes } from 'node:crypto';
import { join } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { getBlob, putBlob } from '../src/store/blobs.ts';
import { openStore } from '../src/store/open.ts';
import { codeOf, DRIVERS, tempDirs } from './helpers/store.ts';

const text = (value: string): Uint8Array => new TextEncoder().encode(value);

describe.each(DRIVERS)('blobs with $name', (driver) => {
  const temp = tempDirs();
  afterEach(temp.cleanUp);
  const open = () => openStore({ path: join(temp.next(), 'orglens.sqlite'), driver });

  it('returns exactly what was stored', () => {
    const store = open();
    const contents = [
      text('public class AccountService {\n  // café\n}\n'.repeat(50)),
      text('x'),
      new Uint8Array(0),
      new Uint8Array(randomBytes(4096)),
    ];
    for (const content of contents) {
      const blob = putBlob(store, content);
      expect(getBlob(store, blob.id)).toEqual(content);
    }
    store.close();
  });

  it('addresses content by its SHA-256', () => {
    const store = open();
    expect(putBlob(store, text('abc')).sha256).toBe('ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad');
    store.close();
  });

  it('stores the same content once', () => {
    const store = open();
    const first = putBlob(store, text('same content'));
    const again = putBlob(store, text('same content'));
    const other = putBlob(store, text('other content'));
    expect(first.created).toBe(true);
    expect(again).toEqual({ ...first, created: false });
    expect(other.id).not.toBe(first.id);
    expect(store.get('SELECT count(*) AS n FROM blob')).toEqual({ n: 2 });
    store.close();
  });

  it('compresses content only when that makes it smaller', () => {
    const store = open();
    const repetitive = putBlob(store, text('<fields><fullName>Region__c</fullName></fields>\n'.repeat(200)));
    const random = putBlob(store, new Uint8Array(randomBytes(2048)));
    const stored = (id: number) =>
      store.get('SELECT encoding, raw_size, length(body) AS stored FROM blob WHERE id = ?', id);
    expect(stored(repetitive.id)).toMatchObject({ encoding: 1, raw_size: 9600 });
    expect(Number(stored(repetitive.id)?.['stored'])).toBeLessThan(500);
    expect(stored(random.id)).toEqual({ encoding: 0, raw_size: 2048, stored: 2048 });
    store.close();
  });

  it('notices a damaged body instead of returning it', () => {
    const store = open();
    const compressed = putBlob(store, text('public class A {}\n'.repeat(100)));
    const plain = putBlob(store, new Uint8Array(randomBytes(64)));
    const truncated = putBlob(store, text('public class B {}\n'.repeat(100)));
    store.run('UPDATE blob SET body = ? WHERE id = ?', new Uint8Array([1, 2, 3]), compressed.id);
    store.run('UPDATE blob SET body = ? WHERE id = ?', new Uint8Array(randomBytes(64)), plain.id);
    store.run('UPDATE blob SET raw_size = raw_size + 1 WHERE id = ?', truncated.id);
    for (const blob of [compressed, plain, truncated]) {
      expect(codeOf(() => getBlob(store, blob.id))).toBe('STORE_FAILED');
    }
    store.close();
  });

  it('treats a blob id that does not exist as a bug in the caller', () => {
    const store = open();
    expect(codeOf(() => getBlob(store, 999))).toBe('INTERNAL');
    store.close();
  });

  it('takes part in the transaction it is called in', () => {
    const store = open();
    expect(() =>
      store.write(() => {
        putBlob(store, text('rolled back'));
        throw new Error('stop');
      }),
    ).toThrow('stop');
    expect(store.get('SELECT count(*) AS n FROM blob')).toEqual({ n: 0 });
    store.close();
  });
});
