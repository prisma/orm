/**
 * Brings checked-in `migrations/` trees onto the 0.17 bare-hex hash
 * representation: strips the legacy `sha256:` prefix from every hash literal,
 * maps the empty-tree sentinel `sha256:empty` to `empty`, recomputes each
 * migration's `migrationHash` over the bare-hex content, and repoints
 * `refs/*.json` at the recomputed hashes.
 *
 * Background: starting at the 0.17 release, content hashes are bare
 * lowercase hex — the `sha256:` prefix is gone from every surface (emitted
 * `contract.json` / `contract.d.ts`, migration manifests, refs, CLI output,
 * and the marker/ledger tables). The algorithm never varied per hash, so the
 * prefix carried no information; a format change is signalled by the hash
 * value changing, not by an in-band tag. Loaders now reject the legacy
 * prefixed form outright.
 *
 * Two distinct effects on checked-in migration artifacts:
 *
 *   - Contract hashes (`from` / `to` in `migration.json`, `storageHash` /
 *     `profileHash` in contract snapshots and `.d.ts` branded literals,
 *     `storageHash` stamps inside `ops.json`) keep their VALUE — only the
 *     `sha256:` prefix drops.
 *   - `migrationHash` VALUES change, because the hashed manifest bytes embed
 *     the (now bare) `from` / `to` strings. Every manifest gets a freshly
 *     recomputed hash, and every `refs/*.json` that pointed at an old
 *     migration hash is rewritten to the recomputed one.
 *
 * Before 0.17 a manifest was:
 *
 *   {
 *     "from": "sha256:8ee1e7ce…",
 *     "to": "sha256:059f3f35…",
 *     "providedInvariants": [],
 *     "createdAt": "2026-…",
 *     "migrationHash": "sha256:3c5205d2…"
 *   }
 *
 * Starting at 0.17 the same manifest is:
 *
 *   {
 *     "from": "8ee1e7ce…",
 *     "to": "059f3f35…",
 *     "providedInvariants": [],
 *     "createdAt": "2026-…",
 *     "migrationHash": "2be2085f…"   // recomputed over the bare-hex bytes
 *   }
 *
 * Format-preserving edit: hash literals are rewritten in place via a targeted
 * pattern (`"sha256:<64 hex>"` / `"sha256:empty"`, single- or double-quoted),
 * and the `migrationHash` value is swapped in place. Every other byte (key
 * order, indentation, inline-vs-expanded arrays) is left exactly as the
 * authoring tool wrote it, so diffs stay minimal.
 *
 * Confinement: an on-disk migration package is a `migration.json` paired
 * with a sibling `ops.json`. The walk keys off that pair; within a package
 * directory every `.json` / `.ts` sibling (pre-store contract snapshots,
 * `.d.ts` branded types, the executable `migration.ts`) has its hash
 * literals stripped. Content-addressed store entries
 * (`migrations/snapshots/<hex>/contract.json` + `contract.d.ts`) are also
 * covered, so the codemod handles both the pre-store sibling layout and the
 * store layout — run it BEFORE `scripts/migrate-migrations-layout.mjs` when
 * converting the layout in the same upgrade (the 0.17 migrator accepts only
 * bare-hex trees). Store directory names are the hash's hex, which is
 * unchanged by the prefix drop, so no directory is renamed. Ref files are
 * `refs/*.json` under a directory named `migrations`; each gets old-hash →
 * recomputed-hash repointing plus prefix stripping (which also maps the
 * `sha256:empty` sentinel to `empty`).
 *
 * The hash algorithm is replicated inline (canonicalisation rules from
 * `@internal/framework-components` `canonicalizeJson` + the
 * migration-tools `computeMigrationHash`, which returns bare hex from 0.17)
 * so this script stays self-contained — consumers run it via `pnpm exec tsx`
 * from their project root with no dependency on any `@internal/*` package
 * being resolvable from that root.
 *
 * The codemod is idempotent: an already-bare tree carries no `sha256:`
 * literals and its recomputed hashes match the stored ones, so the edit is a
 * no-op and every file is left untouched.
 *
 * Flags:
 *   --check   dry-run; lists files that still need fixing and exits 1 if
 *             any remain.
 */
import { createHash } from 'node:crypto';
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, sep } from 'node:path';

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
 * Content-addressed migration hash over (metadata envelope, ops), 0.17 form:
 * bare hex, no prefix. The `migrationHash` field is stripped before hashing
 * so the same function works at write time (no hash yet) and at recompute
 * time (rehashing an already-attested record over the bare-hex envelope).
 */
function computeMigrationHash(metadata: Record<string, unknown>, ops: unknown): string {
  const { migrationHash: _migrationHash, ...strippedMeta } = metadata;

  const partHashes = [canonicalizeJson(strippedMeta), canonicalizeJson(ops)].map(sha256Hex);
  return sha256Hex(canonicalizeJson(partHashes));
}

// --- Prefix stripping ------------------------------------------------------

// A legacy hash literal: `sha256:` + 64 lowercase hex chars, or the
// empty-tree sentinel `sha256:empty`, in single or double quotes. Quoting is
// required so prose that merely mentions the prefix is never rewritten.
const LEGACY_HASH_LITERAL = /(["'])sha256:([0-9a-f]{64}|empty)\1/g;

function stripHashPrefixes(text: string): string {
  return text.replace(LEGACY_HASH_LITERAL, (_full, quote: string, hash: string) => {
    return `${quote}${hash}${quote}`;
  });
}

function replaceMigrationHash(text: string, oldHash: string, newHash: string): string {
  if (oldHash === newHash) return text;
  const re = new RegExp(`("migrationHash"[ \\t]*:[ \\t]*)"${oldHash}"`);
  if (re.exec(text) === null) {
    throw new Error('could not locate the migrationHash value to replace');
  }
  return text.replace(re, (_full, prefix: string) => `${prefix}"${newHash}"`);
}

// --- Filesystem walk ------------------------------------------------------

interface WalkResult {
  readonly manifests: string[];
  readonly refFiles: string[];
  readonly snapshotFiles: string[];
}

async function findMigrationArtifacts(root: string): Promise<WalkResult> {
  const manifests: string[] = [];
  const refFiles: string[] = [];
  const snapshotFiles: string[] = [];

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
      const path = join(dir, entry.name);
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(path);
      } else if (entry.isFile() && entry.name === 'migration.json') {
        manifests.push(path);
      } else if (
        entry.isFile() &&
        entry.name.endsWith('.json') &&
        basename(dir) === 'refs' &&
        dirname(dir).split(sep).includes('migrations')
      ) {
        refFiles.push(path);
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.json') || entry.name.endsWith('.ts')) &&
        basename(dirname(dir)) === 'snapshots' &&
        dirname(dirname(dir)).split(sep).includes('migrations')
      ) {
        snapshotFiles.push(path);
      }
    }
  }

  await walk(root);
  return {
    manifests: manifests.sort(),
    refFiles: refFiles.sort(),
    snapshotFiles: snapshotFiles.sort(),
  };
}

// --- Per-file transforms ---------------------------------------------------

/** Narrows an arbitrary JSON-parsed value to a plain object (manifest shape). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

type Status = 'already-clean' | 'needs-fix' | 'fixed' | 'skipped-no-ops';

interface Result {
  readonly path: string;
  readonly status: Status;
}

const results: Result[] = [];
/** Old migration hash (as previously stored, prefixed) → recomputed bare hash. */
const migrationHashMap = new Map<string, string>();

async function emit(path: string, before: string, after: string): Promise<Result> {
  if (after === before) {
    return { path, status: 'already-clean' };
  }
  if (!dryRun) await writeFile(path, after, 'utf-8');
  return { path, status: dryRun ? 'needs-fix' : 'fixed' };
}

async function processSibling(path: string): Promise<Result> {
  const raw = await readFile(path, 'utf-8');
  return emit(path, raw, stripHashPrefixes(raw));
}

async function processPackage(manifestPath: string): Promise<Result[]> {
  const raw = await readFile(manifestPath, 'utf-8');

  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch (error) {
    throw new Error(
      `${manifestPath}: not valid JSON (${error instanceof Error ? error.message : String(error)})`,
    );
  }
  if (!isJsonObject(parsed)) {
    return [{ path: manifestPath, status: 'already-clean' }]; // not a manifest object
  }

  const packageDir = dirname(manifestPath);

  // A complete on-disk migration package pairs `migration.json` with a sibling
  // `ops.json` (the operations the hash is computed over); without it we cannot
  // recompute the hash, so this is not a package we should touch.
  const opsPath = join(packageDir, 'ops.json');
  let opsRaw: string;
  try {
    opsRaw = await readFile(opsPath, 'utf-8');
  } catch {
    return [{ path: manifestPath, status: 'skipped-no-ops' }];
  }

  const out: Result[] = [];

  // Ops: strip prefixes (e.g. `meta.storageHash` stamps inside operation
  // payloads), then parse the stripped text — the recomputed hash covers the
  // bare-hex operations exactly as they will sit on disk.
  const strippedOpsRaw = stripHashPrefixes(opsRaw);
  const ops: unknown = JSON.parse(strippedOpsRaw);
  out.push(await emit(opsPath, opsRaw, strippedOpsRaw));

  // Manifest: strip prefixes from `from` / `to` (and the sentinel), then
  // recompute `migrationHash` over the bare-hex envelope + bare-hex ops.
  // Canonicalisation is order/whitespace independent, so parsing the stripped
  // text is the right input regardless of on-disk formatting.
  const strippedManifestRaw = stripHashPrefixes(raw);
  const strippedMeta = JSON.parse(strippedManifestRaw);
  if (!isJsonObject(strippedMeta)) {
    throw new Error(`${manifestPath}: manifest is not a JSON object`);
  }
  const newHash = computeMigrationHash(strippedMeta, ops);

  const oldStoredHash = parsed['migrationHash'];
  if (typeof oldStoredHash !== 'string') {
    throw new Error(`${manifestPath}: manifest is missing a string \`migrationHash\` field`);
  }
  const strippedOldHash = stripHashPrefixes(`"${oldStoredHash}"`).slice(1, -1);
  migrationHashMap.set(oldStoredHash, newHash);
  migrationHashMap.set(strippedOldHash, newHash);

  out.push(
    await emit(
      manifestPath,
      raw,
      replaceMigrationHash(strippedManifestRaw, strippedOldHash, newHash),
    ),
  );

  // Siblings: contract snapshots (`*-contract.json`), branded-literal type
  // files (`*.d.ts`), and the executable `migration.ts` all carry contract
  // hash literals whose value is stable — only the prefix drops.
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(packageDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isFile()) continue;
    if (entry.name === 'migration.json' || entry.name === 'ops.json') continue;
    if (!entry.name.endsWith('.json') && !entry.name.endsWith('.ts')) continue;
    out.push(await processSibling(join(packageDir, entry.name)));
  }
  return out;
}

async function processRefFile(path: string): Promise<Result> {
  const raw = await readFile(path, 'utf-8');

  // Repoint at recomputed migration hashes first (a ref stores the migration
  // hash of the package it names), then strip any remaining prefixes — which
  // covers contract-hash refs and maps `sha256:empty` → `empty`.
  let text = raw;
  for (const [oldHash, newHash] of migrationHashMap) {
    if (oldHash === newHash) continue;
    text = text.replaceAll(`"${oldHash}"`, `"${newHash}"`);
  }
  text = stripHashPrefixes(text);

  return emit(path, raw, text);
}

// --- Driver ---------------------------------------------------------------

const { manifests, refFiles, snapshotFiles } = await findMigrationArtifacts(projectRoot);
if (manifests.length === 0 && refFiles.length === 0 && snapshotFiles.length === 0) {
  console.error(`No migration artifacts found under ${projectRoot}.`);
  process.exit(1);
}

for (const manifestPath of manifests) {
  results.push(...(await processPackage(manifestPath)));
}
for (const snapshotPath of snapshotFiles) {
  results.push(await processSibling(snapshotPath));
}
for (const refPath of refFiles) {
  results.push(await processRefFile(refPath));
}

let changed = 0;
let alreadyClean = 0;
let skipped = 0;
for (const result of results) {
  const rel = result.path.slice(projectRoot.length + 1);
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
  `${results.length} file(s) scanned: ${changed} ${dryRun ? 'needing fix' : 'fixed'}, ${alreadyClean} already clean${skipped > 0 ? `, ${skipped} skipped (no ops.json)` : ''}.`,
);

if (dryRun && changed > 0) process.exit(1);
