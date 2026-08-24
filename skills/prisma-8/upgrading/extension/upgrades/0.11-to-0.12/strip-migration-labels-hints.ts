/**
 * Brings on-disk `migration.json` manifests into the slimmed 0.12 metadata
 * model: drops the now-removed `labels` and `hints` keys and recomputes
 * `migrationHash` over the surviving metadata envelope + sibling `ops.json`.
 *
 * Background: starting at the 0.12 release the migration manifest schema is
 * closed (`'+': 'reject'`) — `labels` and `hints` are no longer part of the
 * model, so any manifest still carrying either key fails to load with
 * `INVALID_MANIFEST` naming the offending key. The two fields also no longer
 * participate in the content-addressed migration identity: `migrationHash` is
 * now computed over `{ from, to, providedInvariants, createdAt }` plus the
 * sibling operations, so every migrated manifest gets a freshly recomputed
 * hash over the slimmed envelope.
 *
 * Before 0.12 the on-disk shape was:
 *
 *   {
 *     "from": null,
 *     "to": "sha256:…",
 *     "labels": [],
 *     "providedInvariants": ["…"],
 *     "createdAt": "2026-…",
 *     "hints": { "used": [], "applied": [], "plannerVersion": "2.0.0" },
 *     "migrationHash": "sha256:…"
 *   }
 *
 * Starting at 0.12 the same manifest is:
 *
 *   {
 *     "from": null,
 *     "to": "sha256:…",
 *     "providedInvariants": ["…"],
 *     "createdAt": "2026-…",
 *     "migrationHash": "sha256:…"   // recomputed over the slimmed envelope
 *   }
 *
 * Format-preserving edit: rather than reparse-and-reserialise (which would
 * reflow every value to a single canonical style and bloat the diff), this
 * codemod performs a surgical text edit — it removes only the `labels` and
 * `hints` top-level key lines and swaps the `migrationHash` value in place.
 * Every other byte (key order, indentation, and whether arrays like
 * `providedInvariants` are written inline or expanded) is left exactly as the
 * authoring tool wrote it, so the diff is limited to the two removed keys and
 * the new hash value.
 *
 * Confinement: an on-disk migration package is a `migration.json` paired with
 * a sibling `ops.json` (the operations the hash is computed over). The walk
 * keys off that pair rather than off a `migrations/` directory name, because
 * migration packages live under several roots in practice (`migrations/`,
 * `migration-fixtures/`, …); a `migration.json` with no sibling `ops.json` is
 * not a complete package and is left untouched.
 *
 * The hash algorithm is replicated inline (canonicalisation rules from
 * `@internal/framework-components` `canonicalizeJson` + the migration-tools
 * `computeMigrationHash`) so this script stays self-contained — consumers run
 * it via `pnpm exec tsx` from their project root with no dependency on any
 * `@internal/*` package being resolvable from that root.
 *
 * The codemod is idempotent: an already-slimmed manifest carries no
 * `labels`/`hints` and already has its recomputed hash, so the edit is a no-op
 * and the file is left untouched.
 *
 * Flags:
 *   --check   dry-run; lists manifests that still need fixing and exits 1 if
 *             any remain.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

const dryRun = process.argv.includes('--check');
const projectRoot = process.cwd();

// --- Inline canonicalisation + hash --------------------------------------
// Replicated from `@internal/framework-components` `canonicalizeJson`
// (sortKeys + JSON.stringify) and the migration-tools `computeMigrationHash`.
// Kept inline so the script has no `@internal/*` import — pnpm's strict
// node_modules layout won't resolve transitive framework deps from a
// consumer's project root.

function sortKeys(value: unknown): unknown {
  if (value === null || typeof value !== 'object') {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map(sortKeys);
  }
  const sorted: Record<string, unknown> = Object.create(null);
  for (const [key, entry] of Object.entries(value).sort(([a], [b]) =>
    a < b ? -1 : a > b ? 1 : 0,
  )) {
    sorted[key] = sortKeys(entry);
  }
  return sorted;
}

function canonicalizeJson(value: unknown): string {
  return JSON.stringify(sortKeys(value));
}

function sha256Hex(input: string): string {
  return createHash('sha256').update(input).digest('hex');
}

/**
 * Content-addressed migration hash over (metadata envelope, ops). The
 * `migrationHash` field is stripped before hashing so the same function works
 * at write time (no hash yet) and at recompute time (rehashing an
 * already-attested record over the slimmed envelope).
 */
function computeMigrationHash(metadata: Record<string, unknown>, ops: unknown): string {
  const { migrationHash: _migrationHash, ...strippedMeta } = metadata;

  const partHashes = [canonicalizeJson(strippedMeta), canonicalizeJson(ops)].map(sha256Hex);
  return `sha256:${sha256Hex(canonicalizeJson(partHashes))}`;
}

// --- Format-preserving text surgery --------------------------------------

/**
 * Returns the index just past the end of the JSON value that starts at
 * `start` (which must point at the value's first character). Handles strings
 * (with escapes), nested objects/arrays, and primitives. Used to locate the
 * full span of a top-level key's value when removing the key from the raw
 * text without reparsing the whole document.
 */
function scanValueEnd(text: string, start: number): number {
  const c = text[start];

  if (c === '"') {
    let i = start + 1;
    while (i < text.length) {
      if (text[i] === '\\') {
        i += 2;
        continue;
      }
      if (text[i] === '"') return i + 1;
      i += 1;
    }
    throw new Error('unterminated string while scanning JSON value');
  }

  if (c === '{' || c === '[') {
    const open = c;
    const close = c === '{' ? '}' : ']';
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const ch = text[i];
      if (ch === '"') {
        i = scanValueEnd(text, i);
        continue;
      }
      if (ch === open) depth += 1;
      else if (ch === close) {
        depth -= 1;
        if (depth === 0) return i + 1;
      }
      i += 1;
    }
    throw new Error('unterminated container while scanning JSON value');
  }

  // Primitive (number / true / false / null) — run to the next structural
  // terminator.
  let i = start;
  while (i < text.length && !',}]\r\n \t'.includes(text[i]!)) i += 1;
  return i;
}

/**
 * Removes a top-level object key (and its value) from `text`, preserving the
 * surrounding bytes exactly. No-op (returns `text`) if the key is absent.
 * Only the top-level `labels` / `hints` keys are ever passed here; both always
 * precede the trailing `migrationHash` key, so a removed key always carries a
 * trailing comma that is consumed along with the line.
 */
function removeTopLevelKey(text: string, key: string): string {
  // A top-level key is the only occurrence of `"key":` preceded by a newline
  // (line 1 is the opening `{`). Tolerant of any indentation width.
  const re = new RegExp(`\\n([ \\t]*)"${key}"[ \\t]*:[ \\t]*`);
  const match = re.exec(text);
  if (match === null) return text;

  const lineStart = match.index + 1; // position just after the leading newline
  const valueStart = match.index + match[0].length;
  let after = scanValueEnd(text, valueStart);

  while (text[after] === ' ' || text[after] === '\t') after += 1;
  if (text[after] === ',') after += 1;
  if (text[after] === '\r') after += 1;
  if (text[after] === '\n') after += 1;

  return text.slice(0, lineStart) + text.slice(after);
}

function replaceMigrationHash(text: string, oldHash: string, newHash: string): string {
  if (oldHash === newHash) return text;
  // Tolerate any whitespace around the colon (`"migrationHash":"…"`,
  // `"migrationHash" : "…"`), matching the leniency of `removeTopLevelKey`.
  const escapedOld = oldHash.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`("migrationHash"[ \\t]*:[ \\t]*)"${escapedOld}"`);
  const match = re.exec(text);
  if (match === null) {
    throw new Error('could not locate the migrationHash value to replace');
  }
  return text.replace(re, (_full, prefix: string) => `${prefix}"${newHash}"`);
}

// --- Filesystem walk ------------------------------------------------------

async function findMigrationManifests(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      // Unreadable directory — skip silently. The consumer's project root may
      // legitimately contain restricted directories.
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name === 'migration.json') {
        out.push(join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return out.sort();
}

// --- Per-file transform ---------------------------------------------------

/** Narrows an arbitrary JSON-parsed value to a plain object (manifest shape). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Status = 'already-clean' | 'needs-fix' | 'fixed' | 'skipped-no-ops';

interface Result {
  readonly path: string;
  readonly status: Status;
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
  if (!isJsonObject(parsed)) {
    return { path, status: 'already-clean' }; // not a manifest object
  }
  const metadata = parsed;

  // A complete on-disk migration package pairs `migration.json` with a sibling
  // `ops.json` (the operations the hash is computed over); without it we cannot
  // recompute the hash, so this is not a package we should touch.
  const opsPath = join(dirname(path), 'ops.json');
  let ops: unknown;
  try {
    ops = JSON.parse(await readFile(opsPath, 'utf-8'));
  } catch {
    return { path, status: 'skipped-no-ops' };
  }

  // Recompute over the slimmed envelope (canonicalisation is order/whitespace
  // independent, so the parsed object is the right input regardless of on-disk
  // formatting). `computeMigrationHash` strips `migrationHash` internally.
  const slimmed = { ...metadata };
  delete slimmed['labels'];
  delete slimmed['hints'];
  const newHash = computeMigrationHash(slimmed, ops);

  let out = raw;
  out = removeTopLevelKey(out, 'labels');
  out = removeTopLevelKey(out, 'hints');

  const oldHash = metadata['migrationHash'];
  if (typeof oldHash === 'string') {
    out = replaceMigrationHash(out, oldHash, newHash);
  } else if (out !== raw) {
    // labels/hints were present but there is no string migrationHash to update
    // — a malformed manifest we refuse to guess at.
    throw new Error(`${path}: manifest is missing a string \`migrationHash\` field`);
  }

  if (out === raw) {
    return { path, status: 'already-clean' };
  }
  if (!dryRun) await writeFile(path, out, 'utf-8');
  return { path, status: dryRun ? 'needs-fix' : 'fixed' };
}

// --- Driver ---------------------------------------------------------------

const manifests = await findMigrationManifests(projectRoot);
if (manifests.length === 0) {
  console.error(`No migration.json files found under ${projectRoot}.`);
  process.exit(1);
}

let changed = 0;
let alreadyClean = 0;
let skipped = 0;
for (const path of manifests) {
  const result = await processFile(path);
  const rel = path.slice(projectRoot.length + 1);
  if (result.status === 'already-clean') {
    alreadyClean += 1;
  } else if (result.status === 'skipped-no-ops') {
    skipped += 1;
    console.log(`SKIP  ${rel}  (no sibling ops.json — not a migration package)`);
  } else {
    changed += 1;
    const verb = dryRun ? 'WOULD FIX' : 'FIXED';
    console.log(`${verb} ${rel}`);
  }
}

console.log();
console.log(
  `${manifests.length} manifest(s) scanned: ${changed} ${dryRun ? 'needing fix' : 'fixed'}, ${alreadyClean} already clean${skipped > 0 ? `, ${skipped} skipped (no ops.json)` : ''}.`,
);

if (dryRun && changed > 0) process.exit(1);
