/**
 * Stamps the `kind` discriminator on every entry in `storage.types`
 * inside every on-disk contract snapshot reachable from the project
 * root (`start-contract.json` / `end-contract.json` under any
 * `migrations/` directory).
 *
 * Background: starting at the 0.10 release, the SQL family's
 * `SqlStorage.types` polymorphic slot is strictly typed via an
 * enumerable `kind` discriminator (`'codec-instance'` for codec
 * triples; `'postgres-enum'` for Postgres enums). The family
 * `ContractSerializer` rejects untagged entries with a diagnostic
 * naming the offending entry — the previous silent fallthrough in
 * `normaliseTypeEntry` is gone. See TML-2536.
 *
 * Before 0.10, the on-disk shape was:
 *
 *   "storage": {
 *     "types": {
 *       "Embedding1536": {
 *         "codecId": "pg/vector@1",
 *         "nativeType": "vector",
 *         "typeParams": { "length": 1536 }
 *       },
 *       "user_type": {
 *         "codecId": "pg/enum@1",
 *         "nativeType": "user_type",
 *         "typeParams": { "values": ["admin", "user"] }
 *       }
 *     }
 *   }
 *
 * Starting at 0.10 the same entries are:
 *
 *   "storage": {
 *     "types": {
 *       "Embedding1536": {
 *         "kind": "codec-instance",
 *         "codecId": "pg/vector@1",
 *         "nativeType": "vector",
 *         "typeParams": { "length": 1536 }
 *       },
 *       "user_type": {
 *         "kind": "postgres-enum",
 *         "name": "user_type",
 *         "nativeType": "user_type",
 *         "values": ["admin", "user"],
 *         "codecId": "pg/enum@1"
 *       }
 *     }
 *   }
 *
 * Dispatch rules (per entry):
 *
 * - Already-stamped entry (carries a `kind` field) → left untouched.
 * - `codecId === "pg/enum@1"` → rewritten as the `postgres-enum`
 *   shape: `kind`, `name` (lifted from the entry key), `nativeType`,
 *   `values` (lifted out of `typeParams.values`), `codecId`.
 *   `typeParams` is dropped (its only meaningful content was `values`).
 * - Any other `codecId` → rewritten as the `codec-instance` shape:
 *   `kind` prepended; `codecId`, `nativeType`, `typeParams` preserved.
 *   This is the safe default for unknown codec IDs (including any
 *   future extension-contributed codecs).
 *
 * The transformation re-serialises each affected file via
 * `JSON.stringify(value, null, 2) + '\n'` — the same formatting the
 * CLI uses when authoring snapshots originally, so the diff outside
 * `storage.types` is zero on files the CLI generated. Hand-edited
 * contract snapshots may experience cosmetic whitespace shifts; this
 * is acceptable because on-disk contract snapshots are CLI-authored
 * artefacts, not user-edited source.
 *
 * The codemod is idempotent: running it on already-stamped snapshots
 * is a no-op (every entry passes the `kind`-already-present check).
 *
 * Flags:
 *   --check   dry-run; lists affected files and exits 1 if any still
 *             need fixing.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);
const CONTRACT_FILES = new Set(['start-contract.json', 'end-contract.json']);

const POSTGRES_ENUM_CODEC_ID = 'pg/enum@1';

const dryRun = process.argv.includes('--check');
const projectRoot = process.cwd();

interface Result {
  readonly path: string;
  readonly status: 'already-clean' | 'needs-fix' | 'fixed';
  readonly stamped: number;
}

async function findContractSnapshots(root: string): Promise<string[]> {
  const out: string[] = [];

  // The `inMigrations` flag confines snapshot rewrites to the
  // `migrations/` subtree the doc promises. Without the flag the walk
  // would happily stamp any `start-contract.json` / `end-contract.json`
  // found anywhere under the project root, including non-migration
  // fixtures (e.g. inline contract test snapshots).
  async function walk(dir: string, inMigrations: boolean): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory — skip silently. Mirrors the predecessor
      // 0.8→0.9 codemod's failure-tolerant walk; the user's project
      // root may legitimately contain restricted directories.
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name), inMigrations || entry.name === 'migrations');
      } else if (inMigrations && entry.isFile() && CONTRACT_FILES.has(entry.name)) {
        out.push(join(dir, entry.name));
      }
    }
  }

  await walk(root, false);
  return out.sort();
}

interface UntaggedCodecTriple {
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;
}

interface StampedCodecInstance {
  readonly kind: 'codec-instance';
  readonly codecId: string;
  readonly nativeType: string;
  readonly typeParams: Record<string, unknown>;
}

interface StampedPostgresEnum {
  readonly kind: 'postgres-enum';
  readonly name: string;
  readonly nativeType: string;
  readonly values: readonly string[];
  readonly codecId: string;
}

type StampedEntry = StampedCodecInstance | StampedPostgresEnum;

function isAlreadyStamped(value: unknown): boolean {
  if (typeof value !== 'object' || value === null) return false;
  const kind = (value as { kind?: unknown }).kind;
  return kind === 'codec-instance' || kind === 'postgres-enum';
}

function looksLikeUntaggedCodecTriple(value: unknown): value is UntaggedCodecTriple {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  if (
    typeof obj['codecId'] !== 'string' ||
    typeof obj['nativeType'] !== 'string' ||
    typeof obj['typeParams'] !== 'object' ||
    obj['typeParams'] === null
  ) {
    return false;
  }
  // A `pg/enum@1` triple is only recognisable as an untagged enum if its
  // `typeParams.values` is already a string[]. Without this guard a
  // malformed enum entry would slip through the classifier and surface
  // a different (more specific) diagnostic from `stampEntry` than the
  // outer "neither stamped nor untagged-triple — hand-edit required"
  // throw. Folding that case into the predicate gives every malformed
  // entry the same single diagnostic shape.
  if (obj['codecId'] === POSTGRES_ENUM_CODEC_ID) {
    const values = (obj['typeParams'] as { values?: unknown })['values'];
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
      return false;
    }
  }
  return true;
}

function stampEntry(name: string, raw: UntaggedCodecTriple): StampedEntry {
  if (raw.codecId === POSTGRES_ENUM_CODEC_ID) {
    const values = (raw.typeParams as { values?: unknown })['values'];
    // Invariant: `looksLikeUntaggedCodecTriple` already gated this — a
    // `pg/enum@1` entry that reaches `stampEntry` has a string[]
    // `typeParams.values`. The runtime check stays as a defensive
    // marker so a future loosening of the predicate doesn't silently
    // produce a malformed StampedPostgresEnum.
    if (!Array.isArray(values) || !values.every((v) => typeof v === 'string')) {
      throw new Error(
        `invariant: storage.types[${JSON.stringify(name)}] reached stampEntry with codecId="${POSTGRES_ENUM_CODEC_ID}" but typeParams.values is not a string[]; the classifier should have rejected this entry`,
      );
    }
    return {
      kind: 'postgres-enum',
      name,
      nativeType: raw.nativeType,
      values,
      codecId: raw.codecId,
    };
  }
  return {
    kind: 'codec-instance',
    codecId: raw.codecId,
    nativeType: raw.nativeType,
    typeParams: raw.typeParams,
  };
}

interface ProcessOutcome {
  readonly transformed: Record<string, unknown> | null;
  readonly stamped: number;
}

function processContract(parsed: unknown, filePath: string): ProcessOutcome {
  if (typeof parsed !== 'object' || parsed === null) {
    return { transformed: null, stamped: 0 };
  }
  const root = parsed as Record<string, unknown>;
  const storage = root['storage'];
  if (typeof storage !== 'object' || storage === null) {
    return { transformed: null, stamped: 0 };
  }
  const storageObj = storage as Record<string, unknown>;
  const types = storageObj['types'];
  if (typeof types !== 'object' || types === null) {
    return { transformed: null, stamped: 0 };
  }
  const typesObj = types as Record<string, unknown>;

  let stamped = 0;
  const newTypes: Record<string, unknown> = {};
  for (const [name, entry] of Object.entries(typesObj)) {
    if (isAlreadyStamped(entry)) {
      newTypes[name] = entry;
      continue;
    }
    if (!looksLikeUntaggedCodecTriple(entry)) {
      throw new Error(
        `${filePath}: storage.types[${JSON.stringify(name)}] is neither a stamped entry nor an untagged codec triple — refusing to guess. Hand-edit required.`,
      );
    }
    newTypes[name] = stampEntry(name, entry);
    stamped += 1;
  }

  if (stamped === 0) return { transformed: null, stamped: 0 };

  return {
    transformed: { ...root, storage: { ...storageObj, types: newTypes } },
    stamped,
  };
}

/**
 * Pretty-print JSON with multi-line objects/arrays (per
 * `JSON.stringify(null, 2)` conventions) but inline arrays of primitives
 * (strings, numbers, booleans, null) whose serialised length fits
 * within `INLINE_ARRAY_THRESHOLD`. This matches the on-disk shape the
 * CLI's contract-snapshot writer produces (e.g. `"columns": ["id"]`,
 * `"values": ["admin", "user"]`) — the alternative (Node's default
 * `JSON.stringify(null, 2)`) reflows every such array onto multiple
 * lines and bloats the diff with hundreds of lines of cosmetic noise.
 *
 * The non-array, non-object surfaces match `JSON.stringify(null, 2)`
 * byte-for-byte (same key ordering — insertion order — and same
 * quoting/escaping). The only divergence is inline-primitive-arrays.
 */
const INLINE_ARRAY_THRESHOLD = 80;

function isPrimitive(value: unknown): boolean {
  return (
    value === null ||
    typeof value === 'string' ||
    typeof value === 'number' ||
    typeof value === 'boolean'
  );
}

function formatJson(value: unknown, indentLevel = 0): string {
  const indent = '  '.repeat(indentLevel);
  const childIndent = '  '.repeat(indentLevel + 1);

  if (value === null) return 'null';
  if (typeof value === 'string') return JSON.stringify(value);
  if (typeof value === 'number' || typeof value === 'boolean') return JSON.stringify(value);

  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    if (value.every(isPrimitive)) {
      const inline = `[${value.map((v) => JSON.stringify(v)).join(', ')}]`;
      if (inline.length <= INLINE_ARRAY_THRESHOLD) return inline;
    }
    const items = value.map((v) => `${childIndent}${formatJson(v, indentLevel + 1)}`);
    return `[\n${items.join(',\n')}\n${indent}]`;
  }

  if (typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>);
    if (entries.length === 0) return '{}';
    const lines = entries.map(
      ([k, v]) => `${childIndent}${JSON.stringify(k)}: ${formatJson(v, indentLevel + 1)}`,
    );
    return `{\n${lines.join(',\n')}\n${indent}}`;
  }

  throw new Error(`Unsupported value: ${typeof value}`);
}

async function processFile(path: string): Promise<Result> {
  const raw = await readFile(path, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${path}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  const outcome = processContract(parsed, path);
  if (outcome.transformed === null) {
    return { path, status: 'already-clean', stamped: 0 };
  }
  const serialised = `${formatJson(outcome.transformed)}\n`;
  if (!dryRun) await writeFile(path, serialised, 'utf-8');
  return { path, status: dryRun ? 'needs-fix' : 'fixed', stamped: outcome.stamped };
}

const contracts = await findContractSnapshots(projectRoot);
if (contracts.length === 0) {
  console.error(`No start-contract.json / end-contract.json files found under ${projectRoot}.`);
  process.exit(1);
}

let changed = 0;
let alreadyClean = 0;
let totalStamped = 0;
for (const path of contracts) {
  const result = await processFile(path);
  const rel = path.slice(projectRoot.length + 1);
  if (result.status === 'already-clean') {
    alreadyClean += 1;
    console.log(`OK    ${rel}  (already stamped or no storage.types)`);
  } else {
    changed += 1;
    totalStamped += result.stamped;
    const verb = dryRun ? 'WOULD FIX' : 'FIXED';
    console.log(`${verb} ${rel}  (stamped ${result.stamped} entry/entries)`);
  }
}

console.log();
console.log(
  `${contracts.length} snapshot(s) scanned: ${changed} ${dryRun ? 'needing fix' : 'fixed'} (${totalStamped} entries), ${alreadyClean} already clean.`,
);

if (dryRun && changed > 0) process.exit(1);
