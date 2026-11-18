/**
 * Re-emits every contract whose MTI variant tables (PSL `@@base(Parent, "tag")`
 * models that carry their own `@@map`) predate the base-PK link column.
 *
 * Starting at this release, a `@@base` variant stored in its own table
 * materialises a base-PK link column in storage: the variant table gains an
 * `id` column, a single-column primary key on it, and a cascading foreign key
 * referencing the base table's primary key. Before the change, the variant
 * table held only the variant-specific columns with no primary key.
 *
 * Detection: a contract is a candidate when its domain carries a model with a
 * `base` reference (an MTI variant) whose matching storage table has no
 * `primaryKey` — the pre-change shape. After re-emit the table gains its
 * `id` PK + cascading FK and the contract's `storageHash` changes.
 *
 * Dispatch: walks the project root for `prisma.config.ts` directories,
 * resolves each space's committed `contract.json`, and re-emits when a variant
 * table still lacks its link column. Uses the nearest ancestor `package.json`
 * `scripts.emit` when present; otherwise runs
 * `prisma-next contract emit --config <path>`.
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

/**
 * A contract needs the MTI link-column migration when any of its domain models
 * is an MTI variant (carries a `base` reference) whose matching storage table
 * has no `primaryKey` — the pre-change shape that lacks the link column.
 */
function contractNeedsMtiLinkColumns(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }
  if (!isJsonObject(parsed)) return false;

  const domain = parsed['domain'];
  const storage = parsed['storage'];
  if (!isJsonObject(domain) || !isJsonObject(storage)) return false;

  const domainNamespaces = domain['namespaces'];
  const storageNamespaces = storage['namespaces'];
  if (!isJsonObject(domainNamespaces) || !isJsonObject(storageNamespaces)) return false;

  for (const [nsKey, ns] of Object.entries(domainNamespaces)) {
    if (!isJsonObject(ns)) continue;
    const models = ns['models'];
    if (!isJsonObject(models)) continue;
    for (const model of Object.values(models)) {
      if (!isJsonObject(model)) continue;
      if (!isJsonObject(model['base'])) continue;
      const variantStorage = model['storage'];
      if (!isJsonObject(variantStorage)) continue;
      const tableName = variantStorage['table'];
      // The variant table's namespace defaults to the model's enclosing domain
      // namespace when `storage.namespace` is absent.
      const namespaceId =
        typeof variantStorage['namespace'] === 'string' ? variantStorage['namespace'] : nsKey;
      if (typeof tableName !== 'string') continue;
      const storageNs = storageNamespaces[namespaceId];
      if (!isJsonObject(storageNs)) continue;
      const tables = storageNs['tables'];
      if (!isJsonObject(tables)) continue;
      const table = tables[tableName];
      if (!isJsonObject(table)) continue;
      if (table['primaryKey'] === undefined || table['primaryKey'] === null) {
        return true;
      }
    }
  }
  return false;
}

async function packageJsonHasScript(dir: string, name: string): Promise<boolean> {
  const pkgPath = join(dir, 'package.json');
  if (!(await pathExists(pkgPath))) return false;
  const raw = await readFile(pkgPath, 'utf-8');
  try {
    const parsed: unknown = JSON.parse(raw);
    if (!isJsonObject(parsed)) return false;
    const scripts = parsed['scripts'];
    if (!isJsonObject(scripts)) return false;
    const value = scripts[name];
    return typeof value === 'string' && value.length > 0;
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
    if (await packageJsonHasScript(dir, 'emit')) {
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
  if (await packageJsonHasScript(configDir, 'build:contract-space')) continue;
  const contractPath = await resolveContractJson(configDir);
  if (contractPath === null) continue;
  const raw = await readFile(contractPath, 'utf-8');
  if (!contractNeedsMtiLinkColumns(raw)) continue;
  const { key } = await resolveEmitInvocation(configDir);
  if (emitKeys.has(key)) continue;
  emitKeys.add(key);
  targets.push({ configDir, contractPath });
}

if (targets.length === 0) {
  console.error(`No MTI variant link-column migration candidates under ${projectRoot}.`);
  process.exit(dryRun ? 0 : 1);
}

let needsFix = 0;

for (const { configDir, contractPath } of targets) {
  const rel = configDir.slice(projectRoot.length + 1) || '.';
  const raw = await readFile(contractPath, 'utf-8');
  if (!contractNeedsMtiLinkColumns(raw)) {
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
