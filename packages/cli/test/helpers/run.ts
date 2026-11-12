import { mkdtempSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Ajv2020, type ValidateFunction } from 'ajv/dist/2020.js';
import { main } from '../../src/main.ts';

const schema = JSON.parse(readFileSync(new URL('../../schemas/output.schema.json', import.meta.url), 'utf8')) as Record<
  string,
  unknown
>;

/** The schema of the `--json` output, as it is published with the package. */
export const outputSchema = schema;

const validate: ValidateFunction = new Ajv2020({ allErrors: true }).compile(schema);

export interface Run {
  readonly code: number;
  readonly stdout: string;
  readonly stderr: string;
}

export interface Envelope {
  readonly schemaVersion: number;
  readonly command: string | null;
  readonly ok: boolean;
  readonly data: unknown;
  readonly warnings: readonly unknown[];
  readonly error: {
    readonly code: string;
    readonly message: string;
    readonly hint: string | null;
    readonly details: Record<string, unknown>;
  } | null;
}

export type Environment = Readonly<Record<string, string | undefined>>;

/** Runs the CLI inside this process, with its own current folder and environment. */
export async function orglens(cwd: string, args: readonly string[], env: Environment = {}): Promise<Run> {
  let stdout = '';
  let stderr = '';
  const code = await main(['node', 'orglens', ...args], {
    stdout: (text) => {
      stdout += text;
    },
    stderr: (text) => {
      stderr += text;
    },
    cwd,
    env,
  });
  return { code, stdout, stderr };
}

/**
 * Runs the CLI with `--json` and returns the envelope. Every output that
 * passes through here is checked against the published schema, so the
 * schema and the output cannot drift apart.
 */
export async function orglensJson(
  cwd: string,
  args: readonly string[],
  env: Environment = {},
): Promise<Envelope & { readonly code: number }> {
  const run = await orglens(cwd, [...args, '--json'], env);
  if (run.stderr !== '') throw new Error(`--json wrote to the standard error stream: ${run.stderr}`);
  if (!run.stdout.endsWith('\n') || run.stdout.indexOf('\n') !== run.stdout.length - 1) {
    throw new Error(`--json did not write exactly one line: ${run.stdout}`);
  }
  const envelope = JSON.parse(run.stdout) as Envelope;
  if (!validate(envelope)) {
    throw new Error(`The output does not match the schema: ${JSON.stringify(validate.errors)}\n${run.stdout}`);
  }
  return { ...envelope, code: run.code };
}

/** True if the value matches the published schema. */
export function matchesSchema(value: unknown): boolean {
  return validate(value);
}

/** Temporary folders, removed by `cleanUp`. */
export function tempDirs(): { next: () => string; cleanUp: () => void } {
  const dirs: string[] = [];
  return {
    next: () => {
      const dir = mkdtempSync(join(tmpdir(), 'orglens-cli-'));
      dirs.push(dir);
      return dir;
    },
    cleanUp: () => {
      // On Windows a database file can stay locked for a moment after it is closed.
      for (const dir of dirs.splice(0)) rmSync(dir, { recursive: true, force: true, maxRetries: 10, retryDelay: 50 });
    },
  };
}
