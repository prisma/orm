// Renames `table`/`column` to `entry`/`field` in execution default refs of contracts under `migrations/`.
import { readdir, readFile, writeFile } from 'node:fs/promises';
import { join, relative, sep } from 'node:path';

const SKIP_DIRS = new Set(['node_modules', '.git', 'dist']);
const RENAMES = new Map([
  ['table', 'entry'],
  ['column', 'field'],
]);

const check = process.argv.includes('--check');
const projectRoot = process.cwd();

function isContractFile(name: string): boolean {
  return name.endsWith('.json') || name.endsWith('.d.ts');
}

async function findMigrationFiles(dir: string, found: string[] = []): Promise<string[]> {
  for (const entry of await readdir(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory() && !SKIP_DIRS.has(entry.name)) {
      await findMigrationFiles(path, found);
    } else if (
      entry.isFile() &&
      isContractFile(entry.name) &&
      relative(projectRoot, dir).split(sep).includes('migrations')
    ) {
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

function parseJson(text: string): unknown {
  try {
    return JSON.parse(text);
  } catch {
    return undefined;
  }
}

function serializeLike(original: string, value: unknown): string {
  if (original === `${JSON.stringify(sortKeys(parseJson(original)))}\n`) {
    return `${JSON.stringify(sortKeys(value))}\n`;
  }
  const indent = /\n([ \t]+)/.exec(original)?.[1] ?? 2;
  return `${JSON.stringify(value, null, indent)}${original.endsWith('\n') ? '\n' : ''}`;
}

function renameInJson(text: string): string {
  const contract = parseJson(text);
  if (!isObject(contract) || !isObject(contract['execution'])) return text;
  const mutations = contract['execution']['mutations'];
  const defaults = isObject(mutations) ? mutations['defaults'] : undefined;
  if (!Array.isArray(defaults)) return text;
  let changed = false;
  for (const entry of defaults) {
    if (!isObject(entry) || !isObject(entry['ref'])) continue;
    const keys = Object.keys(entry['ref']);
    if (!keys.some((key) => RENAMES.has(key))) continue;
    entry['ref'] = sortKeys(
      Object.fromEntries(
        Object.entries(entry['ref']).map(([key, value]) => [RENAMES.get(key) ?? key, value]),
      ),
    );
    changed = true;
  }
  return changed ? serializeLike(text, contract) : text;
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
  const files = await findMigrationFiles(projectRoot);
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
    `${files.length} file(s) under migrations/ scanned, ${changed} ${check ? 'need' : 'got'} the rename.`,
  );
  if (check && changed > 0) process.exit(1);
}

void main();
