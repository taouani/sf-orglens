/**
 * Writing the analysis of a snapshot: its components and their references (decision record 0040).
 *
 * A component has one row for its key. What an analysis found for it is a version, and a version is stored once:
 * a second snapshot in which the component is the same adds a row to the list of the snapshot and nothing else.
 * Two versions are the same when everything they hold is the same, and that includes the content of what
 * defines the component and every reference with its place.
 *
 * The analysis of a snapshot is written in one transaction and replaced as a whole.
 */
import { hash } from 'node:crypto';
import { EngineError, type JsonValue } from '../core/errors.ts';
import { parentKey, type ComponentKey } from '../core/keys.ts';
import {
  CONFIDENCE_TIERS,
  REFERENCE_KINDS,
  REFERENCE_ORIGINS,
  RESOLUTIONS,
  type Reference,
  type ReferenceOrigin,
} from '../core/references.ts';
import type { AnalysedComponent, OriginWork } from '../extraction/analysed.ts';
import type { Store } from './open.ts';
import type { SnapshotIssue } from './snapshots.ts';

/**
 * The numbers that stand for the values of the reference vocabulary in the database. The table
 * `reference_vocabulary` holds the same list, and a test compares the two. A number is never given a new
 * meaning: a new value gets the next number, in a new migration.
 */
export const REFERENCE_CODES = {
  kind: {
    reads: 1,
    writes: 2,
    calls: 3,
    extends: 4,
    implements: 5,
    'uses-type': 6,
    'triggers-on': 7,
    grants: 8,
    references: 9,
  },
  origin: {
    'parser:xml': 1,
    'parser:formula': 2,
    'parser:flow': 3,
    'parser:apex': 4,
    symboltable: 5,
    'dependency-api': 6,
  },
  confidence: { confirmed: 1, probable: 2, possible: 3 },
  resolution: { resolved: 1, unresolved: 2, external: 3, dynamic: 4 },
} as const satisfies {
  kind: Record<Reference['kind'], number>;
  origin: Record<Reference['origin'], number>;
  confidence: Record<Reference['confidence'], number>;
  resolution: Record<Reference['resolution'], number>;
};

/** The value a number of the database stands for, or `undefined` for a number that stands for none. */
const named = <T extends string>(
  codes: Readonly<Record<T, number>>,
  values: readonly string[],
): readonly (T | undefined)[] => {
  const names: (T | undefined)[] = [];
  for (const value of values) {
    const code = (codes as Readonly<Record<string, number | undefined>>)[value];
    if (code !== undefined) names[code] = value as T;
  }
  return names;
};

/** From a number of the database to the value it stands for. */
export const REFERENCE_NAMES = {
  kind: named(REFERENCE_CODES.kind, REFERENCE_KINDS),
  origin: named(REFERENCE_CODES.origin, REFERENCE_ORIGINS),
  confidence: named(REFERENCE_CODES.confidence, CONFIDENCE_TIERS),
  resolution: named(REFERENCE_CODES.resolution, RESOLUTIONS),
} as const;

export type { AnalysedComponent, OriginWork };

export interface Analysis {
  readonly engineVersion: string;
  /** UTC, as `Date.prototype.toISOString` writes it. */
  readonly analysedAt: string;
  /** Every component of the snapshot, each key once. It is read once, so it can be made as it is read. */
  readonly components: Iterable<AnalysedComponent>;
  /** One entry for every origin that looked at the snapshot. An origin with references must have one. */
  readonly work: readonly OriginWork[];
  /** What went wrong or is uncertain in the analysis. */
  readonly issues: readonly SnapshotIssue[];
}

export interface AnalysisWritten {
  readonly components: number;
  readonly references: number;
  /** Versions that no snapshot held before. */
  readonly versionsAdded: number;
  /**
   * Versions that no snapshot holds any more, removed with their references. They are looked for only when
   * this analysis replaced another, and then all of them are removed, also those a deleted snapshot left.
   */
  readonly versionsRemoved: number;
}

/** A JSON value as text, with the keys of every object in order, so that equal values give equal text. */
function canonical(value: JsonValue): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value);
  if (Array.isArray(value)) return `[${(value as readonly JsonValue[]).map(canonical).join(',')}]`;
  const object = value as Readonly<Record<string, JsonValue>>;
  const parts = Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonical(object[key] ?? null)}`);
  return `{${parts.join(',')}}`;
}

const attrsText = (attrs: Readonly<Record<string, JsonValue>> | null | undefined): string | null =>
  attrs === null || attrs === undefined ? null : canonical(attrs);

/** A reference as the store writes it: its text for the digest, and what orders it among the others. */
interface Prepared {
  readonly reference: Reference;
  readonly attrs: string | null;
  readonly text: string;
}

function prepare(component: AnalysedComponent, reference: Reference): Prepared {
  if (reference.from !== component.key) {
    throw new EngineError('REFERENCE_INVALID', 'A reference is stored with the component it starts from.', {
      details: { from: String(reference.from), component: String(component.key) },
    });
  }
  const attrs = attrsText(reference.attrs);
  const { location } = reference;
  const text = JSON.stringify([
    reference.to,
    // With a key, the type is the type of the key, and only the key is stored.
    reference.to === null ? reference.toType : null,
    reference.toNameRaw,
    reference.kind,
    reference.origin,
    reference.confidence,
    reference.resolution,
    location?.file ?? null,
    location?.line ?? null,
    location?.column ?? null,
    attrs,
  ]);
  return { reference, attrs, text };
}

/** The order of the references of a version: by place, and by their text where the place is the same. */
function byPlace(a: Prepared, b: Prepared): number {
  const one = a.reference.location;
  const other = b.reference.location;
  const file = (one?.file ?? '') < (other?.file ?? '') ? -1 : (one?.file ?? '') > (other?.file ?? '') ? 1 : 0;
  if (file !== 0) return file;
  const line = (one?.line ?? 0) - (other?.line ?? 0);
  if (line !== 0) return line;
  const column = (one?.column ?? 0) - (other?.column ?? 0);
  if (column !== 0) return column;
  return a.text < b.text ? -1 : a.text > b.text ? 1 : 0;
}

/**
 * The number of the form of the text a digest is taken over. A change to what that text holds, or to how it
 * is written, gives every component a new version in the next snapshot. The number says that this happened.
 */
const DIGEST_FORMAT = 1;

const hex = (bytes: Uint8Array): string =>
  Buffer.from(bytes.buffer, bytes.byteOffset, bytes.byteLength).toString('hex');

/** The number that stands for a value of the vocabulary. A value outside the vocabulary is refused. */
function codeOf(family: keyof typeof REFERENCE_CODES, value: string, reference: Reference): number {
  const codes: Readonly<Record<string, number>> = REFERENCE_CODES[family];
  const code = Object.hasOwn(codes, value) ? codes[value] : undefined;
  if (code === undefined) {
    throw new EngineError('REFERENCE_INVALID', `"${value}" is not a ${family} of the reference vocabulary.`, {
      details: { from: String(reference.from), to: reference.to === null ? null : String(reference.to) },
    });
  }
  return code;
}

const INSERT_REFERENCE = `INSERT INTO reference
  (version_id, seq, target_id, target_type, raw_name, kind, origin, confidence, resolution, path_id, line, col, attrs)
  VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`;

/**
 * Writes the analysis of a snapshot, in one transaction. An analysis the snapshot had before is replaced, and
 * the versions that only it held are removed.
 *
 * The references are trusted to have passed `validateReference`, and the store does not run it again. It
 * checks that a reference starts from the component it is stored with and that its four values are of the
 * vocabulary. The tables refuse a place that is no place, a name that is empty, and a resolution or a
 * confidence that does not fit to having a target key or none. Nothing is written then. What neither checks:
 * that a parser gave a place with a column, that a path has forward slashes, and that the type of a target
 * without a key is a type name.
 */
export function writeAnalysis(store: Store, snapshotId: number, analysis: Analysis): AnalysisWritten {
  return store.write(() => {
    if (store.get('SELECT 1 AS found FROM snapshot WHERE id = ?', snapshotId) === undefined) {
      throw new EngineError(
        'INTERNAL',
        `An analysis was written for the snapshot ${String(snapshotId)}, which does not exist.`,
      );
    }
    const replaced =
      store.get('SELECT 1 AS found FROM snapshot_analysis WHERE snapshot_id = ?', snapshotId) !== undefined;
    if (replaced) {
      store.run('DELETE FROM snapshot_component WHERE snapshot_id = ?', snapshotId);
      store.run('DELETE FROM snapshot_origin_coverage WHERE snapshot_id = ?', snapshotId);
      store.run("DELETE FROM snapshot_issue WHERE snapshot_id = ? AND stage = 'analysis'", snapshotId);
      store.run('DELETE FROM snapshot_analysis WHERE snapshot_id = ?', snapshotId);
    }

    // The ids of the keys and paths this analysis names. Each is looked up once.
    const componentIds = new Map<string, number>();
    const componentId = (key: ComponentKey): number => {
      const known = componentIds.get(key);
      if (known !== undefined) return known;
      const row = store.get('SELECT id FROM component WHERE key = ?', key);
      let id = row === undefined ? undefined : Number(row['id']);
      if (id === undefined) {
        // `parentKey` also checks the key: one that breaks the grammar is refused here.
        const parent = parentKey(key);
        id = store.run(
          'INSERT INTO component (key, parent_id) VALUES (?, ?)',
          key,
          parent === undefined ? null : componentId(parent),
        ).lastInsertRowid;
      }
      componentIds.set(key, id);
      return id;
    };
    const pathIds = new Map<string, number>();
    const pathId = (path: string): number => {
      const known = pathIds.get(path);
      if (known !== undefined) return known;
      const row = store.get('SELECT id FROM file_path WHERE path = ?', path);
      const id =
        row === undefined
          ? store.run('INSERT INTO file_path (path) VALUES (?)', path).lastInsertRowid
          : Number(row['id']);
      pathIds.set(path, id);
      return id;
    };

    const seen = new Set<number>();
    const found = new Map<ReferenceOrigin, { references: number; unresolved: number }>();
    let references = 0;
    let versionsAdded = 0;

    for (const component of analysis.components) {
      const id = componentId(component.key);
      if (seen.has(id)) {
        throw new EngineError('INTERNAL', 'An analysis holds one component twice.', {
          details: { key: String(component.key) },
        });
      }
      seen.add(id);

      const prepared = component.references.map((reference) => prepare(component, reference)).sort(byPlace);
      for (const { reference } of prepared) {
        const count = found.get(reference.origin) ?? { references: 0, unresolved: 0 };
        count.references += 1;
        if (reference.resolution === 'unresolved') count.unresolved += 1;
        found.set(reference.origin, count);
      }
      references += prepared.length;

      const attrs = attrsText(component.attrs);
      // One line for the component and one for each reference. A line is JSON, so it holds no line break.
      const lines = [
        JSON.stringify([
          DIGEST_FORMAT,
          component.name,
          component.definition?.path ?? null,
          component.definition === null ? null : hex(component.definition.contentHash),
          attrs,
        ]),
      ];
      for (const { text } of prepared) lines.push(text);
      const digest = hash('sha256', lines.join('\n'), 'buffer');

      const held = store.get('SELECT id FROM component_version WHERE component_id = ? AND digest = ?', id, digest);
      let versionId = held === undefined ? undefined : Number(held['id']);
      if (versionId === undefined) {
        versionId = store.run(
          'INSERT INTO component_version (component_id, digest, name, path_id, attrs) VALUES (?, ?, ?, ?, ?)',
          id,
          digest,
          component.name,
          component.definition === null ? null : pathId(component.definition.path),
          attrs,
        ).lastInsertRowid;
        versionsAdded += 1;
        for (const [seq, { reference, attrs: referenceAttrs }] of prepared.entries()) {
          const { location } = reference;
          store.run(
            INSERT_REFERENCE,
            versionId,
            seq,
            reference.to === null ? null : componentId(reference.to),
            reference.to === null ? reference.toType : null,
            reference.toNameRaw,
            codeOf('kind', reference.kind, reference),
            codeOf('origin', reference.origin, reference),
            codeOf('confidence', reference.confidence, reference),
            codeOf('resolution', reference.resolution, reference),
            location === undefined ? null : pathId(location.file),
            location?.line ?? null,
            location?.column ?? null,
            referenceAttrs,
          );
        }
      }
      store.run(
        'INSERT INTO snapshot_component (snapshot_id, component_id, version_id) VALUES (?, ?, ?)',
        snapshotId,
        id,
        versionId,
      );
    }

    const work = new Map(analysis.work.map((one) => [one.origin, one]));
    if (work.size !== analysis.work.length) {
      throw new EngineError('INTERNAL', 'An analysis says twice what the analyser of one origin looked at.');
    }
    for (const origin of found.keys()) {
      if (!work.has(origin)) {
        throw new EngineError(
          'INTERNAL',
          `An analysis holds references of the origin "${origin}" and does not say what its analyser looked at.`,
        );
      }
    }
    for (const one of analysis.work) {
      const count = found.get(one.origin) ?? { references: 0, unresolved: 0 };
      store.run(
        `INSERT INTO snapshot_origin_coverage (snapshot_id, origin, components, failed_files, refs, unresolved)
         VALUES (?, ?, ?, ?, ?, ?)`,
        snapshotId,
        REFERENCE_CODES.origin[one.origin],
        one.components,
        one.failedFiles,
        count.references,
        count.unresolved,
      );
    }
    for (const issue of analysis.issues) {
      store.run(
        `INSERT INTO snapshot_issue (snapshot_id, severity, code, component_key, message, details, stage)
         VALUES (?, ?, ?, ?, ?, ?, 'analysis')`,
        snapshotId,
        issue.severity,
        issue.code,
        issue.componentKey,
        issue.message,
        issue.details === null ? null : JSON.stringify(issue.details),
      );
    }
    store.run(
      'INSERT INTO snapshot_analysis (snapshot_id, engine_version, analysed_at, components, refs) VALUES (?, ?, ?, ?, ?)',
      snapshotId,
      analysis.engineVersion,
      analysis.analysedAt,
      seen.size,
      references,
    );

    // Only an analysis that replaced another can leave a version that no snapshot holds.
    const versionsRemoved = replaced
      ? store.run(
          `DELETE FROM component_version WHERE NOT EXISTS
             (SELECT 1 FROM snapshot_component held WHERE held.version_id = component_version.id)`,
        ).changes
      : 0;
    return { components: seen.size, references, versionsAdded, versionsRemoved };
  });
}

export interface AnalysisRecord {
  readonly engineVersion: string;
  readonly analysedAt: string;
  readonly components: number;
  readonly references: number;
}

/** The analysis of a snapshot, or `undefined` for a snapshot that was not analysed. */
export function readAnalysis(store: Store, snapshotId: number): AnalysisRecord | undefined {
  const row = store.get(
    'SELECT engine_version, analysed_at, components, refs FROM snapshot_analysis WHERE snapshot_id = ?',
    snapshotId,
  );
  if (row === undefined) return undefined;
  return {
    engineVersion: String(row['engine_version']),
    analysedAt: String(row['analysed_at']),
    components: Number(row['components']),
    references: Number(row['refs']),
  };
}

/** What the analysers of a snapshot looked at and found, per origin. */
export interface OriginCoverage extends OriginWork {
  /** References of this origin, and how many of them name a target that was not found. */
  readonly references: number;
  readonly unresolved: number;
}

/** The coverage of the analysis of a snapshot per origin, in the order of the vocabulary. */
export function readOriginCoverage(store: Store, snapshotId: number): OriginCoverage[] {
  return store
    .all(
      `SELECT origin, components, failed_files, refs, unresolved FROM snapshot_origin_coverage
        WHERE snapshot_id = ? ORDER BY origin`,
      snapshotId,
    )
    .map((row) => {
      const origin = REFERENCE_NAMES.origin[Number(row['origin'])];
      if (origin === undefined)
        throw new EngineError('INTERNAL', 'The database holds an origin this version does not know.');
      return {
        origin,
        components: Number(row['components']),
        failedFiles: Number(row['failed_files']),
        references: Number(row['refs']),
        unresolved: Number(row['unresolved']),
      };
    });
}
