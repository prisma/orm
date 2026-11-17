/**
 * Re-emits a Postgres extension pack's contract-space and regenerates its
 * install migration baseline after the 0.12 public-by-default flip
 * (`__unbound__`/`postgres-unbound-schema` → `public`/`postgres-schema`).
 *
 * The migration ops are unchanged — only the contract hash envelope moves.
 * This script:
 *   1. Finds extension package roots (nearest `package.json` with a
 *      `build:contract-space` script) whose `src/contract.json` still
 *      carries `postgres-unbound-schema`.
 *   2. Runs `pnpm build:contract-space`.
 *   3. Patches each baseline `migrations/<dir>/migration.ts` `describe().to`
 *      hash to match the new `storageHash`.
 *   4. Self-emits each migration (`pnpm exec tsx <migration.ts>`).
 *   5. Updates `migrations/refs/head.json` `hash` to the new storage hash
 *      (preserves `invariants`).
 *
 * Flags:
 *   --check   dry-run; lists extension roots that still need regeneration
 *             and exits 1 if any remain.
 */
import { execFile } from 'node:child_process';
import { access, copyFile, readdir, readFile, writeFile } from 'node:fs/promises';
import { join } from 'node:path';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist', 'build']);

const dryRun = process.argv.includes('--check');
const projectRoot = process.cwd();

async function pathExists(path: string): Promise<boolean> {
  try {
    await access(path);
    return true;
  } catch {
    return false;
  }
}

function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

async function findPackageJsonFiles(root: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name === 'package.json') {
        out.push(join(dir, entry.name));
      }
    }
  }

  await walk(root);
  return out.sort();
}

function contractNeedsPublicDefaultMigration(raw: string): boolean {
  return (
    raw.includes('"kind": "postgres-unbound-schema"') ||
    raw.includes('"kind":"postgres-unbound-schema"')
  );
}

async function packageHasBuildContractSpace(pkgPath: string): Promise<boolean> {
  const raw = await readFile(pkgPath, 'utf-8');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isJsonObject(parsed)) return false;
    const scripts = parsed['scripts'];
    if (!isJsonObject(scripts)) return false;
    return (
      typeof scripts['build:contract-space'] === 'string' &&
      scripts['build:contract-space'].length > 0
    );
  } catch {
    return false;
  }
}

async function findMigrationDirs(migrationsDir: string): Promise<string[]> {
  const out: string[] = [];
  let entries: Awaited<ReturnType<typeof readdir>>;
  try {
    entries = await readdir(migrationsDir, { withFileTypes: true });
  } catch {
    return out;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const migrationDir = join(migrationsDir, entry.name);
    if (await pathExists(join(migrationDir, 'migration.ts'))) out.push(migrationDir);
  }
  return out.sort();
}

async function readStorageHash(contractPath: string): Promise<string | null> {
  const raw = await readFile(contractPath, 'utf-8');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isJsonObject(parsed)) return null;
    const storage = parsed['storage'];
    if (!isJsonObject(storage)) return null;
    const storageHash = storage['storageHash'];
    return typeof storageHash === 'string' ? storageHash : null;
  } catch {
    return null;
  }
}

async function patchMigrationToHash(
  migrationTsPath: string,
  storageHash: string,
): Promise<boolean> {
  const raw = await readFile(migrationTsPath, 'utf-8');
  const patched = raw.replace(/(\bto:\s*['"])sha256:[0-9a-f]{64}(['"])/, `$1${storageHash}$2`);
  if (patched === raw) return false;
  await writeFile(migrationTsPath, patched);
  return true;
}

async function patchHeadRef(headPath: string, storageHash: string): Promise<boolean> {
  const raw = await readFile(headPath, 'utf-8');
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isJsonObject(parsed)) return false;
  if (parsed['hash'] === storageHash) return false;
  parsed['hash'] = storageHash;
  await writeFile(headPath, `${JSON.stringify(parsed, null, 2)}\n`);
  return true;
}

interface ExtensionRoot {
  readonly dir: string;
  readonly contractPath: string;
}

const extensionRoots: ExtensionRoot[] = [];

for (const pkgPath of await findPackageJsonFiles(projectRoot)) {
  if (!(await packageHasBuildContractSpace(pkgPath))) continue;
  const dir = join(pkgPath, '..');
  const contractPath = join(dir, 'src', 'contract.json');
  if (!(await pathExists(contractPath))) continue;
  const raw = await readFile(contractPath, 'utf-8');
  if (!contractNeedsPublicDefaultMigration(raw)) continue;
  extensionRoots.push({ dir, contractPath });
}

if (extensionRoots.length === 0) {
  console.error(`No extension public-default migration candidates under ${projectRoot}.`);
  process.exit(dryRun ? 0 : 1);
}

let needsFix = 0;
let alreadyClean = 0;

for (const { dir, contractPath } of extensionRoots) {
  const rel = dir.slice(projectRoot.length + 1) || '.';
  const raw = await readFile(contractPath, 'utf-8');
  if (!contractNeedsPublicDefaultMigration(raw)) {
    alreadyClean += 1;
    console.log(`OK    ${rel}`);
    continue;
  }

  needsFix += 1;
  if (dryRun) {
    console.log(`WOULD REGENERATE  ${rel}`);
    continue;
  }

  console.log(`REGENERATE  ${rel}`);
  await execFileAsync('pnpm', ['build:contract-space'], { cwd: dir, env: process.env });

  const storageHash = await readStorageHash(contractPath);
  if (storageHash === null) {
    throw new Error(`Could not read storageHash from ${contractPath}`);
  }

  const migrationsDir = join(dir, 'migrations');
  const srcContractJson = join(dir, 'src', 'contract.json');
  const srcContractDts = join(dir, 'src', 'contract.d.ts');

  for (const migrationDir of await findMigrationDirs(migrationsDir)) {
    await copyFile(srcContractJson, join(migrationDir, 'end-contract.json'));
    if (await pathExists(srcContractDts)) {
      await copyFile(srcContractDts, join(migrationDir, 'end-contract.d.ts'));
    }
    const migrationTs = join(migrationDir, 'migration.ts');
    await patchMigrationToHash(migrationTs, storageHash);
    await execFileAsync('pnpm', ['exec', 'tsx', migrationTs], { cwd: dir, env: process.env });
  }

  const headPath = join(migrationsDir, 'refs', 'head.json');
  if (await pathExists(headPath)) {
    await patchHeadRef(headPath, storageHash);
  }
}

console.log();
console.log(
  `${extensionRoots.length} extension pack(s): ${needsFix} ${dryRun ? 'needing regeneration' : 'regenerated'}, ${alreadyClean} already on public default.`,
);

if (dryRun && needsFix > 0) process.exit(1);
