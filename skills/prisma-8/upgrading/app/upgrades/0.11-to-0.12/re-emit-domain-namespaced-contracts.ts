/**
 * Re-emits every contract artefact still on the pre-0.12 flat domain plane
 * (`contract.models` / `contract.valueObjects` at the contract root) so
 * emitted JSON and `contract.d.ts` pick up `contract.domain.namespaces.<ns>`.
 *
 * Background: starting at 0.12 (symmetric domain plane, ADR 221), models
 * and value objects live under `domain.namespaces`. The supported read
 * paths are `contract.domain.namespaces` plus helpers such as
 * `contractModels()` / `ContractModelsMap`.
 *
 * Dispatch: walks the project root for `prisma.config.ts` directories,
 * resolves each space's committed `contract.json` / `contract.d.ts`, and
 * re-emits when the flat domain shape remains. Uses the nearest ancestor
 * `package.json` `scripts.emit` when present; otherwise runs
 * `prisma-next contract emit --config <path>`.
 *
 * Flags:
 *   --check   dry-run; lists contract-spaces that still need re-emitting
 *             and exits 1 if any remain.
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

function contractDtsCandidates(configDir: string): string[] {
  return [
    join(configDir, 'src', 'contract.d.ts'),
    join(configDir, 'src', 'prisma', 'contract.d.ts'),
    join(configDir, 'prisma', 'contract.d.ts'),
    join(configDir, 'contract.d.ts'),
  ];
}

function contractJsonNeedsDomainPlaneMigration(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isJsonObject(parsed)) return false;
  const domain = parsed['domain'];
  if (!isJsonObject(domain)) return true;
  const namespaces = domain['namespaces'];
  return !isJsonObject(namespaces) || Object.keys(namespaces).length === 0;
}

function contractDtsNeedsDomainPlaneMigration(raw: string): boolean {
  return raw.includes("Contract['models']");
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

async function configDirNeedsDomainPlaneMigration(configDir: string): Promise<boolean> {
  for (const candidate of contractJsonCandidates(configDir)) {
    if (!(await pathExists(candidate))) continue;
    const raw = await readFile(candidate, 'utf-8');
    if (contractJsonNeedsDomainPlaneMigration(raw)) return true;
  }
  for (const candidate of contractDtsCandidates(configDir)) {
    if (!(await pathExists(candidate))) continue;
    const raw = await readFile(candidate, 'utf-8');
    if (contractDtsNeedsDomainPlaneMigration(raw)) return true;
  }
  return false;
}

const configDirs = await findPrismaNextConfigDirs(projectRoot);
const emitKeys = new Set<string>();
const targets: string[] = [];

for (const configDir of configDirs) {
  if (!(await configDirNeedsDomainPlaneMigration(configDir))) continue;
  const { key } = await resolveEmitInvocation(configDir);
  if (emitKeys.has(key)) continue;
  emitKeys.add(key);
  targets.push(configDir);
}

if (targets.length === 0) {
  console.error(`No flat-domain contract candidates under ${projectRoot}.`);
  process.exit(dryRun ? 0 : 1);
}

let needsFix = 0;

for (const configDir of targets) {
  const rel = configDir.slice(projectRoot.length + 1) || '.';
  if (!(await configDirNeedsDomainPlaneMigration(configDir))) {
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
