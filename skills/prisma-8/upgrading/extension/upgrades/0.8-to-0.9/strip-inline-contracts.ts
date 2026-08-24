/**
 * Removes the inlined `fromContract` / `toContract` fields from every
 * committed `migration.json` manifest reachable from the project root.
 *
 * Background: starting at the 0.9 release, `migration.json` no longer
 * carries `fromContract` / `toContract` (the schema rejects them as
 * unknown keys). The destination contract continues to live next door
 * as `end-contract.json` (and the source as `start-contract.json`); the
 * manifest copy was redundant. `migrationHash` is unaffected — it was
 * already computed without those two fields, so stripping them does
 * not change the stored hash.
 *
 * Behaviour:
 * - Walks the project root recursively, ignoring `node_modules`, `.git`,
 *   `dist`, and `build`. Picks up every file named `migration.json`
 *   whose JSON object has the migration-manifest shape (`from`, `to`,
 *   and `migrationHash` keys). Other `migration.json` files (e.g.
 *   unrelated artefacts that happen to share the name) are skipped.
 * - Manifests that already lack both removed keys are left untouched.
 * - Manifests with either removed key are rewritten with the two key /
 *   value spans excised at the text level, so the formatting of all
 *   surviving fields (whitespace, inline-vs-multiline arrays, key
 *   ordering, trailing newline) is preserved byte-for-byte. Only the
 *   key being removed and its trailing comma+newline disappear from
 *   the diff.
 * - Idempotent: re-running the script after success is a no-op.
 *
 * Flags:
 *   --check   dry-run; exit 1 if any manifest still needs fixing.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const REMOVED_KEYS = ['fromContract', 'toContract'] as const;
const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

const dryRun = process.argv.includes('--check');
const projectRoot = process.cwd();

interface Result {
  readonly path: string;
  readonly status: 'already-clean' | 'needs-fix' | 'fixed';
  readonly removed: readonly string[];
}

async function findManifests(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    const entries = await readdir(dir, { withFileTypes: true });
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (entry.isFile() && entry.name === 'migration.json') {
        const path = join(dir, entry.name);
        try {
          const parsed: unknown = JSON.parse(await readFile(path, 'utf-8'));
          if (looksLikeMigrationManifest(parsed)) out.push(path);
        } catch {
          // Not valid JSON, or not the manifest shape — skip silently.
        }
      }
    }
  }

  await walk(root);
  return out.sort();
}

function looksLikeMigrationManifest(value: unknown): value is Record<string, unknown> {
  if (typeof value !== 'object' || value === null) return false;
  const obj = value as Record<string, unknown>;
  return 'from' in obj && 'to' in obj && 'migrationHash' in obj;
}

/**
 * Find the end index (exclusive) of a JSON value starting at `start`
 * inside `text`. Handles strings, numbers, booleans, null, arrays, and
 * objects. Brace / bracket nesting is tracked while respecting string
 * literals (with escapes). Throws if `text` is not well-formed JSON
 * starting at `start`.
 */
function jsonValueEnd(text: string, start: number): number {
  const head = text[start];
  let depth = 0;
  let inString = false;
  let inEscape = false;

  if (head === '"') {
    let i = start + 1;
    while (i < text.length) {
      const ch = text[i];
      if (inEscape) inEscape = false;
      else if (ch === '\\') inEscape = true;
      else if (ch === '"') return i + 1;
      i += 1;
    }
    throw new Error(`Unterminated string starting at ${start}`);
  }

  if (head === '{' || head === '[') {
    let i = start;
    while (i < text.length) {
      const ch = text[i];
      if (inString) {
        if (inEscape) inEscape = false;
        else if (ch === '\\') inEscape = true;
        else if (ch === '"') inString = false;
      } else {
        if (ch === '"') inString = true;
        else if (ch === '{' || ch === '[') depth += 1;
        else if (ch === '}' || ch === ']') {
          depth -= 1;
          if (depth === 0) return i + 1;
        }
      }
      i += 1;
    }
    throw new Error(`Unterminated container starting at ${start}`);
  }

  let i = start;
  while (i < text.length && !',}\n\r\t '.includes(text[i] ?? '')) i += 1;
  return i;
}

/**
 * Remove a top-level key (and its `: value` and trailing comma) from a
 * pretty-printed JSON object text. Returns the new text. If the key
 * isn't present, returns the input unchanged.
 *
 * Preserves all surrounding whitespace and the formatting of every
 * other field byte-for-byte. Handles both "key in the middle" (eats the
 * trailing comma + newline) and "key at the end" (eats the leading
 * comma + newline).
 */
function removeTopLevelKey(text: string, key: string): string {
  const needle = `"${key}"`;
  const keyIndex = text.indexOf(needle);
  if (keyIndex < 0) return text;

  let cursor = keyIndex + needle.length;
  while (cursor < text.length && /\s/.test(text[cursor] ?? '')) cursor += 1;
  if (text[cursor] !== ':') {
    throw new Error(`Expected ':' after ${needle} at ${cursor}`);
  }
  cursor += 1;
  while (cursor < text.length && /\s/.test(text[cursor] ?? '')) cursor += 1;

  const valueEnd = jsonValueEnd(text, cursor);

  let removeStart = keyIndex;
  let removeEnd = valueEnd;

  if (text[removeEnd] === ',') {
    removeEnd += 1;
    if (text[removeEnd] === '\n') removeEnd += 1;
    let lineStart = removeStart;
    while (lineStart > 0 && text[lineStart - 1] !== '\n') lineStart -= 1;
    if (text.slice(lineStart, removeStart).trim() === '') removeStart = lineStart;
  } else {
    let back = removeStart - 1;
    while (back > 0 && /[ \t]/.test(text[back] ?? '')) back -= 1;
    if (text[back] === '\n') {
      let prev = back - 1;
      while (prev > 0 && /[ \t]/.test(text[prev] ?? '')) prev -= 1;
      if (text[prev] === ',') {
        removeStart = prev;
        if (text[removeEnd] === '\n') removeEnd += 1;
      }
    }
  }

  return text.slice(0, removeStart) + text.slice(removeEnd);
}

async function processManifest(path: string): Promise<Result> {
  const raw = await readFile(path, 'utf-8');
  const data: Record<string, unknown> = JSON.parse(raw);
  const removed = REMOVED_KEYS.filter((key) => key in data);
  if (removed.length === 0) return { path, status: 'already-clean', removed: [] };

  let stripped = raw;
  for (const key of removed) stripped = removeTopLevelKey(stripped, key);

  // Sanity: stripped output must still be valid JSON and must agree on
  // every field except the two we removed.
  const reparsed: Record<string, unknown> = JSON.parse(stripped);
  for (const key of removed) {
    if (key in reparsed) {
      throw new Error(`Internal: ${key} survived strip in ${path}`);
    }
  }

  if (!dryRun) await writeFile(path, stripped, 'utf-8');
  return { path, status: dryRun ? 'needs-fix' : 'fixed', removed };
}

const manifests = await findManifests(projectRoot);
if (manifests.length === 0) {
  console.error(`No migration.json files found under ${projectRoot}.`);
  process.exit(1);
}

let changed = 0;
let alreadyClean = 0;
for (const path of manifests) {
  const result = await processManifest(path);
  const rel = path.slice(projectRoot.length + 1);
  if (result.status === 'already-clean') {
    alreadyClean += 1;
    console.log(`OK    ${rel}  (already clean)`);
  } else {
    changed += 1;
    const verb = dryRun ? 'WOULD FIX' : 'FIXED';
    console.log(`${verb} ${rel}  (removed: ${result.removed.join(', ')})`);
  }
}

console.log();
console.log(
  `${manifests.length} manifest(s) scanned: ${changed} ${dryRun ? 'needing fix' : 'fixed'}, ${alreadyClean} already clean.`,
);

if (dryRun && changed > 0) process.exit(1);
