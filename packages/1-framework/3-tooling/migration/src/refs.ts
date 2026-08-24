import { mkdir, readdir, readFile, rename, rmdir, unlink, writeFile } from 'node:fs/promises';
import { type } from 'arktype';
import { dirname, join, relative } from 'pathe';
import {
  errorInvalidRefFile,
  errorInvalidRefName,
  errorInvalidRefValue,
  MigrationToolsError,
} from './errors';

export interface RefEntry {
  readonly hash: string;
  readonly invariants: readonly string[];
}

export type Refs = Readonly<Record<string, RefEntry>>;

/**
 * The system head ref lives at `refs/head.json`. It is read (and its
 * corruption judged) through `readContractSpaceHeadRef`, not as a
 * user-authored ref, so {@link readRefsTolerant} excludes it.
 */
export const HEAD_REF_NAME = 'head';

/**
 * A single ref file that exists on disk but cannot be turned into a
 * {@link RefEntry} (unparseable JSON or schema-invalid content). The ref
 * is omitted from the result; the problem is surfaced for the integrity
 * layer to report as `refUnreadable` rather than aborting the load.
 */
export interface RefLoadProblem {
  readonly refName: string;
  readonly detail: string;
}

export interface TolerantRefsResult {
  readonly refs: Refs;
  readonly problems: readonly RefLoadProblem[];
}

const REF_NAME_PATTERN = /^[a-z0-9]([a-z0-9-]*[a-z0-9])?(\/[a-z0-9]([a-z0-9-]*[a-z0-9])?)*$/;
const REF_VALUE_PATTERN = /^(empty|[0-9a-f]{64})$/;

export function validateRefName(name: string): boolean {
  if (name.length === 0) return false;
  if (name.includes('..')) return false;
  if (name.includes('//')) return false;
  if (name.startsWith('.')) return false;
  return REF_NAME_PATTERN.test(name);
}

export function validateRefValue(value: string): boolean {
  return REF_VALUE_PATTERN.test(value);
}

const RefEntrySchema = type({
  hash: 'string',
  invariants: 'string[]',
}).narrow((entry, ctx) => {
  if (!validateRefValue(entry.hash))
    return ctx.mustBe(`a valid contract hash (got "${entry.hash}")`);
  return true;
});

function refFilePath(refsDir: string, name: string): string {
  return join(refsDir, `${name}.json`);
}

function refNameFromPath(refsDir: string, filePath: string): string {
  const rel = relative(refsDir, filePath);
  return rel.replace(/\.json$/, '');
}

export async function readRef(refsDir: string, name: string): Promise<RefEntry> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  const filePath = refFilePath(refsDir, name);
  let raw: string;
  try {
    raw = await readFile(filePath, 'utf-8');
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      throw new MigrationToolsError('MIGRATION.UNKNOWN_REF', `Unknown ref "${name}"`, {
        why: `No ref file found at "${filePath}".`,
        fix: `Create the ref with: {bin} migration ref set ${name} <hash>`,
        nextActions: [
          {
            kind: 'run-command',
            label: `Create the ref "${name}"`,
            command: `{bin} migration ref set ${name} <hash>`,
          },
        ],
        meta: { refName: name, filePath },
      });
    }
    throw error;
  }

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    throw errorInvalidRefFile(filePath, 'Failed to parse as JSON');
  }

  const result = RefEntrySchema(parsed);
  if (result instanceof type.errors) {
    throw errorInvalidRefFile(filePath, result.summary);
  }

  return result;
}

export async function readRefs(refsDir: string): Promise<Refs> {
  let entries: string[];
  try {
    entries = await readdir(refsDir, { recursive: true, encoding: 'utf-8' });
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return {};
    }
    throw error;
  }

  const jsonFiles = entries.filter(
    (entry) => entry.endsWith('.json') && !entry.endsWith('.contract.json'),
  );
  const refs: Record<string, RefEntry> = {};

  for (const jsonFile of jsonFiles) {
    const filePath = join(refsDir, jsonFile);
    const name = refNameFromPath(refsDir, filePath);

    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (error) {
      // Tolerate the TOCTOU race between `readdir` and `readFile` (ENOENT) and
      // benign EISDIR if a directory happens to end in `.json`. Anything else
      // (EACCES, EIO, EMFILE, …) is a real failure and propagates so the CLI
      // surfaces it rather than silently dropping the ref.
      const code = error instanceof Error ? (error as { code?: string }).code : undefined;
      if (code === 'ENOENT' || code === 'EISDIR') {
        continue;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch {
      throw errorInvalidRefFile(filePath, 'Failed to parse as JSON');
    }

    const result = RefEntrySchema(parsed);
    if (result instanceof type.errors) {
      throw errorInvalidRefFile(filePath, result.summary);
    }

    refs[name] = result;
  }

  return refs;
}

/**
 * Read a space's user-authored refs without ever throwing on disk
 * content. A ref whose JSON is unparseable or whose shape fails
 * {@link RefEntrySchema} is omitted from `refs` and reported as a
 * {@link RefLoadProblem}; the remaining well-formed refs are still
 * returned. A missing `refs/` directory yields no refs and no problems.
 *
 * `refs/head.json` is deliberately skipped here: the system head ref is
 * read through `readContractSpaceHeadRef` (which validates head-ref
 * shape, distinct from the strict user-ref hash grammar), so it is judged
 * there and never doubles as a user ref. Genuine I/O faults (EACCES, EIO,
 * …) still propagate — only parse / schema problems are made tolerant.
 */
export async function readRefsTolerant(refsDir: string): Promise<TolerantRefsResult> {
  let entries: string[];
  try {
    entries = await readdir(refsDir, { recursive: true, encoding: 'utf-8' });
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      return { refs: {}, problems: [] };
    }
    throw error;
  }

  const jsonFiles = entries.filter(
    (entry) =>
      entry.endsWith('.json') &&
      !entry.endsWith('.contract.json') &&
      entry !== `${HEAD_REF_NAME}.json`,
  );
  const refs: Record<string, RefEntry> = {};
  const problems: RefLoadProblem[] = [];

  for (const jsonFile of jsonFiles) {
    const filePath = join(refsDir, jsonFile);
    const name = refNameFromPath(refsDir, filePath);

    let raw: string;
    try {
      raw = await readFile(filePath, 'utf-8');
    } catch (error) {
      // Tolerate the TOCTOU race between `readdir` and `readFile` (ENOENT)
      // and benign EISDIR if a directory happens to end in `.json`.
      // Anything else (EACCES, EIO, …) is a real failure and propagates.
      const code = error instanceof Error ? (error as { code?: string }).code : undefined;
      if (code === 'ENOENT' || code === 'EISDIR') {
        continue;
      }
      throw error;
    }

    let parsed: unknown;
    try {
      parsed = JSON.parse(raw);
    } catch (e) {
      problems.push({ refName: name, detail: e instanceof Error ? e.message : String(e) });
      continue;
    }

    const result = RefEntrySchema(parsed);
    if (result instanceof type.errors) {
      problems.push({ refName: name, detail: result.summary });
      continue;
    }

    refs[name] = result;
  }

  return { refs, problems };
}

export async function writeRef(refsDir: string, name: string, entry: RefEntry): Promise<void> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }
  if (!validateRefValue(entry.hash)) {
    throw errorInvalidRefValue(entry.hash);
  }

  const filePath = refFilePath(refsDir, name);
  const dir = dirname(filePath);
  await mkdir(dir, { recursive: true });

  const tmpPath = join(dir, `.${name.split('/').pop()}.json.${Date.now()}.tmp`);
  await writeFile(
    tmpPath,
    `${JSON.stringify({ hash: entry.hash, invariants: [...entry.invariants] }, null, 2)}\n`,
  );
  await rename(tmpPath, filePath);
}

export async function deleteRef(refsDir: string, name: string): Promise<void> {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  const filePath = refFilePath(refsDir, name);
  try {
    await unlink(filePath);
  } catch (error) {
    if (error instanceof Error && (error as { code?: string }).code === 'ENOENT') {
      throw new MigrationToolsError('MIGRATION.UNKNOWN_REF', `Unknown ref "${name}"`, {
        why: `No ref file found at "${filePath}".`,
        fix: 'Run `{bin} migration ref list` to see available refs.',
        nextActions: [
          {
            kind: 'run-command',
            label: 'List the available refs',
            command: '{bin} migration ref list',
          },
        ],
        meta: { refName: name, filePath },
      });
    }
    throw error;
  }

  // Clean empty parent directories up to refsDir. Stop walking on the expected
  // "directory has siblings" signal (ENOTEMPTY on Linux, EEXIST on some BSDs)
  // and on ENOENT (concurrent removal). Anything else (EACCES, EIO, …) is a
  // real failure and propagates.
  let dir = dirname(filePath);
  while (dir !== refsDir && dir.startsWith(refsDir)) {
    try {
      await rmdir(dir);
      dir = dirname(dir);
    } catch (error) {
      const code = error instanceof Error ? (error as { code?: string }).code : undefined;
      if (code === 'ENOTEMPTY' || code === 'EEXIST' || code === 'ENOENT') {
        break;
      }
      throw error;
    }
  }
}

/**
 * Index user-authored refs by the contract hash each ref points at.
 * Each bucket is sorted lex-asc for deterministic output.
 */
export function refsByContractHash(refs: Refs): ReadonlyMap<string, readonly string[]> {
  const byHash = new Map<string, string[]>();
  for (const [name, entry] of Object.entries(refs)) {
    const bucket = byHash.get(entry.hash);
    if (bucket) bucket.push(name);
    else byHash.set(entry.hash, [name]);
  }
  for (const bucket of byHash.values()) {
    bucket.sort();
  }
  return byHash;
}

/**
 * Read `migrations/<space>/refs/*.json` and index by destination hash.
 * Returns an empty map when the refs directory does not exist.
 */
export async function resolveRefsByContractHash(
  refsDir: string,
): Promise<ReadonlyMap<string, readonly string[]>> {
  return refsByContractHash(await readRefs(refsDir));
}

export function resolveRef(refs: Refs, name: string): RefEntry {
  if (!validateRefName(name)) {
    throw errorInvalidRefName(name);
  }

  // Object.hasOwn gate: plain-object `refs` would otherwise let
  // `refs['constructor']` return Object.prototype.constructor and bypass the
  // UNKNOWN_REF throw. validateRefName accepts `"constructor"` as a name shape.
  if (!Object.hasOwn(refs, name)) {
    throw new MigrationToolsError('MIGRATION.UNKNOWN_REF', `Unknown ref "${name}"`, {
      why: `No ref named "${name}" exists.`,
      fix: `Available refs: ${Object.keys(refs).join(', ') || '(none)'}. Create a ref with: {bin} migration ref set ${name} <hash>`,
      nextActions: [
        {
          kind: 'run-command',
          label: `Create the ref "${name}"`,
          command: `{bin} migration ref set ${name} <hash>`,
          reason: `Available refs: ${Object.keys(refs).join(', ') || '(none)'}.`,
        },
      ],
      meta: { refName: name, availableRefs: Object.keys(refs) },
    });
  }

  // biome-ignore lint/style/noNonNullAssertion: Object.hasOwn gate above guarantees this is defined
  return refs[name]!;
}
