/**
 * Rewrites test-only imports from the removed `@internal/contract/testing`
 * subpath to `@repo/test-utils`.
 *
 * Background: starting at 0.12 the contract test factories (`createContract`,
 * `createSqlContract`, `DUMMY_HASH`, `applicationDomainOf`, …) live in
 * `@repo/test-utils`. The `@internal/contract/testing` export was
 * removed from `@internal/contract`.
 *
 * Behaviour:
 * - Walks the project root recursively, ignoring `node_modules`, `.git`,
 *   `dist`, and `build`.
 * - Rewrites every `.ts` / `.tsx` file whose source contains
 *   `@internal/contract/testing`.
 * - Idempotent: files already importing from `@repo/test-utils` are
 *   left untouched.
 *
 * Flags:
 *   --check   dry-run; lists files that still need rewriting and exits 1 if
 *             any remain.
 */
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';

const FROM = '@internal/contract/testing';
const TO = '@repo/test-utils';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

const dryRun = process.argv.includes('--check');
const projectRoot = process.cwd();

async function findSourceFiles(root: string): Promise<string[]> {
  const out: string[] = [];

  async function walk(dir: string): Promise<void> {
    let entries: Awaited<ReturnType<typeof readdir>>;
    try {
      entries = await readdir(dir, { withFileTypes: true });
    } catch {
      return;
    }
    for (const entry of entries) {
      if (entry.isDirectory()) {
        if (SKIP_DIRS.has(entry.name)) continue;
        await walk(join(dir, entry.name));
      } else if (
        entry.isFile() &&
        (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) &&
        entry.name !== 'migrate-contract-testing-imports.ts'
      ) {
        out.push(join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return out.sort();
}

const files = await findSourceFiles(projectRoot);
const targets: string[] = [];

for (const path of files) {
  const raw = await readFile(path, 'utf-8');
  if (raw.includes(FROM)) targets.push(path);
}

if (targets.length === 0) {
  console.log('No @internal/contract/testing imports found.');
  process.exit(0);
}

let needsFix = 0;
let fixed = 0;

for (const path of targets) {
  const rel = path.slice(projectRoot.length + 1);
  const raw = await readFile(path, 'utf-8');
  const next = raw.replaceAll(FROM, TO);
  if (next === raw) continue;
  needsFix += 1;
  if (dryRun) {
    console.log(`WOULD REWRITE  ${rel}`);
    continue;
  }
  await writeFile(path, next);
  fixed += 1;
  console.log(`REWRITE  ${rel}`);
}

console.log();
console.log(
  `${targets.length} file(s) with legacy import: ${dryRun ? needsFix : fixed} ${dryRun ? 'needing rewrite' : 'rewritten'}.`,
);

if (dryRun && needsFix > 0) process.exit(1);
