/**
 * File contents, stored once per distinct content.
 *
 * A blob is addressed by the SHA-256 of its content. Two snapshots that
 * hold the same file share one row, which is what makes many snapshots
 * cheap. Bodies are compressed with deflate when that makes them smaller.
 */
import { createHash } from 'node:crypto';
import { deflateSync, inflateSync } from 'node:zlib';
import { EngineError } from '../core/errors.ts';
import type { Store } from './open.ts';

const ENCODING_RAW = 0;
const ENCODING_DEFLATE = 1;

export interface StoredBlob {
  readonly id: number;
  /** The SHA-256 of the content, in hexadecimal. */
  readonly sha256: string;
  /** False if the same content was already stored. */
  readonly created: boolean;
}

/** Stores content and returns its blob. Storing the same content twice gives the same blob. */
export function putBlob(store: Store, content: Uint8Array): StoredBlob {
  const digest = createHash('sha256').update(content).digest();
  const sha256 = digest.toString('hex');
  const find = (): unknown => store.get('SELECT id FROM blob WHERE sha256 = ?', digest)?.['id'];
  // Looked up first, because most files of a snapshot are already stored and need not be compressed again.
  const existing = find();
  if (typeof existing === 'number') return { id: existing, sha256, created: false };

  const deflated = deflateSync(content);
  const compress = deflated.byteLength < content.byteLength;
  // Another process can have stored the same content since the look-up. Then this insert does nothing.
  const { changes } = store.run(
    'INSERT INTO blob (sha256, encoding, raw_size, body) VALUES (?, ?, ?, ?) ON CONFLICT (sha256) DO NOTHING',
    digest,
    compress ? ENCODING_DEFLATE : ENCODING_RAW,
    content.byteLength,
    compress ? deflated : content,
  );
  const id = find();
  if (typeof id !== 'number') throw new EngineError('INTERNAL', 'A blob was stored and cannot be found.');
  return { id, sha256, created: changes === 1 };
}

/** Returns the content of a blob, checked against its hash. */
export function getBlob(store: Store, id: number): Uint8Array {
  const row = store.get('SELECT sha256, encoding, raw_size, body FROM blob WHERE id = ?', id);
  if (!row) throw new EngineError('INTERNAL', `Blob ${String(id)} does not exist.`);
  const { sha256, encoding, raw_size: rawSize, body } = row;
  const corrupt = (cause?: unknown): EngineError =>
    new EngineError('STORE_FAILED', `Blob ${String(id)} of the workspace database is damaged.`, {
      hint: 'Take the snapshot again.',
      details: { path: store.path, blob: id },
      cause,
    });
  if (!(body instanceof Uint8Array) || !(sha256 instanceof Uint8Array)) throw corrupt();

  let content: Uint8Array;
  try {
    // The recorded size bounds the result, so a damaged body cannot inflate to more than was stored.
    const limit = typeof rawSize === 'number' ? Math.max(rawSize, 1) : 1;
    content = encoding === ENCODING_DEFLATE ? new Uint8Array(inflateSync(body, { maxOutputLength: limit })) : body;
  } catch (cause) {
    throw corrupt(cause);
  }
  const digest = createHash('sha256').update(content).digest();
  if (content.byteLength !== rawSize || !digest.equals(sha256)) throw corrupt();
  return content;
}
