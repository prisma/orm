/**
 * Re-emits every Postgres contract whose default namespace still uses the
 * pre-0.12 `__unbound__` / `postgres-unbound-schema` sentinel so emitted
 * `contract.json` / `contract.d.ts` pick up the `public` / `postgres-schema`
 * default (public-by-default).
 *
 * Starting at 0.12, un-namespaced Postgres models resolve to the `public`
 * namespace id. Explicit `namespace unbound { … }` in PSL still round-trips
 * to `__unbound__`; this script targets only contracts whose *default*
 * namespace is still the old sentinel shape.
 *
 * Dispatch: walks the project root for `prisma.config.ts` directories,
 * resolves each space's committed `contract.json`, and re-emits when the
 * storage tree still includes `"kind": "postgres-unbound-schema"`. Uses
 * the nearest ancestor `package.json` `scripts.emit` when present; otherwise
 * runs `prisma-next contract emit --config <path>`.
 *
 * Flags:
 *   --check   dry-run; lists contract-spaces that still need re-emitting and
 *             exits 1 if any remain.
 */
import { execFile } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
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

async function findPrismaNextConfigDirs(root: string): Promise<string[]> {
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
      } else if (entry.isFile() && entry.name === 'prisma.config.ts') {
        out.push(dir);
      }
    }
  }

  await walk(root);
  return out.sort();
}

function contractJsonCandidates(configDir: string): string[] {
  return [
    join(configDir, 'src', 'contract.json'),
    join(configDir, 'src', 'prisma', 'contract.json'),
    join(configDir, 'prisma', 'contract.json'),
    join(configDir, 'contract.json'),
  ];
}

async function resolveContractJson(configDir: string): Promise<string | null> {
  for (const candidate of contractJsonCandidates(configDir)) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

function contractNeedsPublicDefaultMigration(raw: string): boolean {
  return (
    raw.includes('"kind": "postgres-unbound-schema"') ||
    raw.includes('"kind":"postgres-unbound-schema"')
  );
}

async function packageJsonHasEmitScript(dir: string): Promise<boolean> {
  const pkgPath = join(dir, 'package.json');
  if (!(await pathExists(pkgPath))) return false;
  const raw = await readFile(pkgPath, 'utf-8');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isJsonObject(parsed)) return false;
    const scripts = parsed['scripts'];
    if (!isJsonObject(scripts)) return false;
    return typeof scripts['emit'] === 'string' && scripts['emit'].length > 0;
  } catch {
    return false;
  }
}

async function packageJsonHasBuildContractSpaceScript(dir: string): Promise<boolean> {
  const pkgPath = join(dir, 'package.json');
  if (!(await pathExists(pkgPath))) return false;
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

async function resolveEmitInvocation(configDir: string): Promise<{
  readonly cwd: string;
  readonly args: string[];
  readonly key: string;
}> {
  let dir = configDir;
  while (dir.startsWith(projectRoot)) {
    if (await packageJsonHasEmitScript(dir)) {
      return { cwd: dir, args: ['emit'], key: `script:${dir}` };
    }
    const parent = dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  const configPath = join(configDir, 'prisma.config.ts');
  return {
    cwd: projectRoot,
    args: ['exec', 'prisma-next', 'contract', 'emit', '--config', configPath],
    key: `config:${configPath}`,
  };
}

async function runEmit(configDir: string): Promise<void> {
  const { cwd, args } = await resolveEmitInvocation(configDir);
  await execFileAsync('pnpm', args, { cwd, env: process.env });
}

const configDirs = await findPrismaNextConfigDirs(projectRoot);
const emitKeys = new Set<string>();
const targets: Array<{ configDir: string; contractPath: string }> = [];

for (const configDir of configDirs) {
  if (await packageJsonHasBuildContractSpaceScript(configDir)) continue;
  const contractPath = await resolveContractJson(configDir);
  if (contractPath === null) continue;
  const raw = await readFile(contractPath, 'utf-8');
  if (!contractNeedsPublicDefaultMigration(raw)) continue;
  const { key } = await resolveEmitInvocation(configDir);
  if (emitKeys.has(key)) continue;
  emitKeys.add(key);
  targets.push({ configDir, contractPath });
}

if (targets.length === 0) {
  console.error(`No Postgres public-default migration candidates under ${projectRoot}.`);
  process.exit(dryRun ? 0 : 1);
}

let needsFix = 0;

for (const { configDir, contractPath } of targets) {
  const rel = configDir.slice(projectRoot.length + 1) || '.';
  const raw = await readFile(contractPath, 'utf-8');
  if (!contractNeedsPublicDefaultMigration(raw)) {
    console.log(`OK    ${rel}`);
    continue;
  }
  needsFix += 1;
  if (dryRun) {
    console.log(`WOULD RE-EMIT  ${rel}`);
    continue;
  }
  console.log(`EMIT  ${rel}`);
  await runEmit(configDir);
}

console.log();
console.log(
  `${targets.length} contract-space(s): ${needsFix} ${dryRun ? 'needing re-emit' : 're-emitted'}.`,
);

if (dryRun && needsFix > 0) process.exit(1);
