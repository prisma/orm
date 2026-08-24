/**
 * Re-emits every Mongo contract in the consumer project so emitted
 * `contract.json` / `contract.d.ts` pick up closed `$jsonSchema`
 * validators (`additionalProperties: false` at every level, including
 * polymorphic `oneOf` branches).
 *
 * Background: starting at the 0.12 release, MongoDB emits closed
 * `$jsonSchema` validators by default. The contract canonicalizer also
 * preserves `additionalProperties` through emission, so re-emitting is
 * the consumer-facing migration for on-disk contract artefacts. A
 * non-variant Mongo model must resolve to an `objectId` `_id`; otherwise
 * interpret fails with `PSL_MONGO_ID_REQUIRED` — fix the PSL/TS source
 * before re-emitting.
 *
 * After re-emitting, apply the resulting open→closed validator migration
 * with `prisma-next db update -y` (or `pnpm db:update -y` if your
 * project wraps it). The planner classifies the validator tightening as
 * `destructive`; without `-y` the apply step refuses to run.
 *
 * Dispatch: walks the project root for directories that contain both
 * `prisma.config.ts` and a committed `contract.json` whose storage
 * tree includes `"kind": "mongo-database"`. In each match, runs
 * `pnpm emit` when a `package.json` scripts.emit entry exists, otherwise
 * `pnpm exec prisma-next contract emit`.
 *
 * Flags:
 *   --check   dry-run; lists directories that would be re-emitted and
 *             exits 1 if any contract.json still lacks closed validators.
 */
import { execFile } from 'node:child_process';
import { access, readdir, readFile } from 'node:fs/promises';
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

async function isMongoContract(contractPath: string): Promise<boolean> {
  const raw = await readFile(contractPath, 'utf-8');
  return raw.includes('"kind": "mongo-database"') || raw.includes('"kind":"mongo-database"');
}

/**
 * A contract is in the closed-validator (post-0.12) format when every object
 * schema that declares a `properties` map also carries `additionalProperties:
 * false`. That covers collection validators, nested value objects, and each
 * polymorphic `oneOf` branch — all of which expose `properties`.
 *
 * The one exception is a polymorphic schema's top-level node: it carries both
 * base `properties` and a `oneOf`, and is deliberately left open because
 * closure is enforced on each branch (a document must match exactly one closed
 * branch). Such a node is exempt from the `additionalProperties: false`
 * requirement, but its branches are still walked and checked.
 *
 * A substring scan is unsafe here: a single closed branch would mask a sibling
 * that still needs re-emitting.
 */
/** Narrows an arbitrary JSON-parsed value to a plain object (non-null, non-array). */
function isJsonObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function contractLooksClosed(raw: string): boolean {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return false;
  }

  function isClosed(node: unknown): boolean {
    if (Array.isArray(node)) return node.every(isClosed);
    if (!isJsonObject(node)) return true;

    const hasProperties = isJsonObject(node['properties']);
    const isPolymorphicTopLevel = Array.isArray(node['oneOf']);
    if (hasProperties && !isPolymorphicTopLevel && node['additionalProperties'] !== false) {
      return false;
    }

    return Object.values(node).every(isClosed);
  }

  return isClosed(parsed);
}

async function packageJsonHasEmitScript(configDir: string): Promise<boolean> {
  const pkgPath = join(configDir, 'package.json');
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

async function runEmit(configDir: string): Promise<void> {
  const hasEmitScript = await packageJsonHasEmitScript(configDir);
  const cmd = hasEmitScript ? 'pnpm' : 'pnpm';
  const args = hasEmitScript ? ['emit'] : ['exec', 'prisma-next', 'contract', 'emit'];
  await execFileAsync(cmd, args, { cwd: configDir, env: process.env });
}

const configDirs = await findPrismaNextConfigDirs(projectRoot);
const mongoDirs: Array<{ dir: string; contractPath: string }> = [];

for (const dir of configDirs) {
  const contractPath = await resolveContractJson(dir);
  if (contractPath === null) continue;
  if (!(await isMongoContract(contractPath))) continue;
  mongoDirs.push({ dir, contractPath });
}

if (mongoDirs.length === 0) {
  console.error(`No Mongo contract directories found under ${projectRoot}.`);
  process.exit(1);
}

let needsFix = 0;
let alreadyClean = 0;

for (const { dir, contractPath } of mongoDirs) {
  const rel = dir.slice(projectRoot.length + 1) || '.';
  const raw = await readFile(contractPath, 'utf-8');
  if (contractLooksClosed(raw)) {
    alreadyClean += 1;
    console.log(`OK    ${rel}`);
    continue;
  }
  needsFix += 1;
  if (dryRun) {
    console.log(`WOULD RE-EMIT  ${rel}`);
    continue;
  }
  console.log(`EMIT  ${rel}`);
  await runEmit(dir);
}

console.log();
console.log(
  `${mongoDirs.length} Mongo contract(s): ${needsFix} ${dryRun ? 'needing re-emit' : 're-emitted'}, ${alreadyClean} already closed.`,
);

if (dryRun && needsFix > 0) process.exit(1);
