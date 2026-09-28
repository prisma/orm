// Renames `table`/`column` to `entry`/`field` in execution default refs of migration contract snapshots.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const SNAPSHOT_FILES = new Set(['contract.json', 'contract.d.ts']);
const RENAMES = new Map([
  ['table', 'entry'],
  ['column', 'field'],
]);

const check = process.argv.includes('--check');
const projectRoot = process.cwd();

function isSnapshotDir(dir: string): boolean {
  return (
    /^[0-9a-f]+$/.test(basename(dir)) &&
    basename(dirname(dir)) === 'snapshots' &&
    dirname(dirname(dir)).split(sep).includes('migrations')
  );
}

async function findSnapshotFiles(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      await findSnapshotFiles(path, found);
    } else if (entry.isFile() && SNAPSHOT_FILES.has(entry.name) && isSnapshotDir(dir)) {
      found.push(path);
    }
  }
  return found;
}

function isObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  const sorted: Record<string, unknown> = {};
  for (const key of Object.keys(value).sort()) sorted[key] = sortKeys(value[key]);
  return sorted;
}

function renameInJson(text: string): string {
  const contract: unknown = JSON.parse(text);
  if (!isObject(contract) || !isObject(contract['execution'])) return text;
  const mutations = contract['execution']['mutations'];
  const defaults = isObject(mutations) ? mutations['defaults'] : undefined;
  if (!Array.isArray(defaults)) return text;
  let changed = false;
  for (const entry of defaults) {
    if (!isObject(entry) || !isObject(entry['ref'])) continue;
    const ref = entry['ref'];
    for (const [from, to] of RENAMES) {
      if (from in ref && !(to in ref)) {
        ref[to] = ref[from];
        delete ref[from];
        changed = true;
      }
    }
  }
  return changed ? `${JSON.stringify(sortKeys(contract))}\n` : text;
}

const REF_BLOCK = /readonly ref: \{([^{}]*)\}/g;
const REF_MEMBER = /readonly (\w+): ('[^']*'|"[^"]*")/g;

function renameInDts(text: string): string {
  return text.replace(REF_BLOCK, (block, body: string) => {
    const members = [...body.matchAll(REF_MEMBER)];
    if (!members.some(([, key = '']) => RENAMES.has(key))) return block;
    const sorted = members
      .map(([, key = '', value = '']) => `readonly ${RENAMES.get(key) ?? key}: ${value}`)
      .sort();
    let i = 0;
    return `readonly ref: {${body.replace(REF_MEMBER, () => sorted[i++] ?? '')}}`;
  });
}

async function main(): Promise<void> {
  const files = await findSnapshotFiles(projectRoot);
  let changed = 0;
  for (const path of files.sort()) {
    const before = await readFile(path, 'utf-8');
    const after = path.endsWith('.json') ? renameInJson(before) : renameInDts(before);
    if (after === before) continue;
    changed += 1;
    console.log(`${check ? 'WOULD FIX' : 'FIXED'} ${relative(projectRoot, path)}`);
    if (!check) await writeFile(path, after, 'utf-8');
  }
  console.log(
    `${files.length} snapshot file(s) scanned, ${changed} ${check ? 'need' : 'got'} the rename.`,
  );
  if (check && changed > 0) process.exit(1);
}

void main();
