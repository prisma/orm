// Renames `table`/`column` to `entry`/`field` in execution default refs of contracts under `migrations/`.
import { readdir, readFile, rename, rm, writeFile } from 'node:fs/promises';
import { basename, dirname, join, relative, sep } from 'node:path';

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

function renameInJson(text: string): string | undefined {
  const contract = parseJson(text);
  if (contract === undefined) return undefined;
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

const DEFAULT_ELEMENT_PATH = ['execution', 'mutations', 'defaults', ''];
const MEMBER_BEFORE_OPENER = /readonly (\w+): (?:readonly )?$/;
const REF_MEMBER = /readonly (\w+): ('(?:[^'\\]|\\.)*'|"(?:[^"\\]|\\.)*")/g;

interface OpenBlock {
  readonly member: string;
  readonly start: number;
  readonly isDefaultRef: boolean;
}

interface Span {
  readonly start: number;
  readonly end: number;
}

function closingQuote(text: string, start: number): number {
  let i = start + 1;
  while (i < text.length && text[i] !== text[start]) i += text[i] === '\\' ? 2 : 1;
  return i;
}

function commentEnd(text: string, start: number): number {
  const end =
    text[start + 1] === '/' ? text.indexOf('\n', start) : text.indexOf('*/', start + 2) + 1;
  return end > start ? end : text.length;
}

function isDefaultElement(open: readonly OpenBlock[]): boolean {
  const members = open.slice(-DEFAULT_ELEMENT_PATH.length).map((block) => block.member);
  return members.join('/') === DEFAULT_ELEMENT_PATH.join('/');
}

function executionDefaultRefs(text: string): Span[] {
  const open: OpenBlock[] = [];
  const refs: Span[] = [];
  for (let i = 0; i < text.length; i++) {
    const char = text[i];
    if (char === "'" || char === '"' || char === '`') {
      i = closingQuote(text, i);
    } else if (char === '/' && (text[i + 1] === '/' || text[i + 1] === '*')) {
      i = commentEnd(text, i);
    } else if (char === '{' || char === '[') {
      const member = MEMBER_BEFORE_OPENER.exec(text.slice(Math.max(0, i - 64), i))?.[1] ?? '';
      const isDefaultRef = char === '{' && member === 'ref' && isDefaultElement(open);
      open.push({ member, start: i, isDefaultRef });
    } else if (char === '}' || char === ']') {
      const block = open.pop();
      if (block?.isDefaultRef) refs.push({ start: block.start, end: i + 1 });
    }
  }
  return refs;
}

function renameRefMembers(block: string): string {
  const members = [...block.matchAll(REF_MEMBER)];
  if (!members.some(([, key = '']) => RENAMES.has(key))) return block;
  const sorted = members
    .map(([, key = '', value = '']) => `readonly ${RENAMES.get(key) ?? key}: ${value}`)
    .sort();
  let i = 0;
  return block.replace(REF_MEMBER, () => sorted[i++] ?? '');
}

function renameInDts(text: string): string {
  let renamed = text;
  for (const { start, end } of executionDefaultRefs(text).reverse()) {
    const block = renameRefMembers(renamed.slice(start, end));
    renamed = `${renamed.slice(0, start)}${block}${renamed.slice(end)}`;
  }
  return renamed;
}

async function replaceFile(path: string, content: string): Promise<void> {
  const temporary = join(dirname(path), `.${basename(path)}.${process.pid}.tmp`);
  try {
    await writeFile(temporary, content, 'utf-8');
    await rename(temporary, path);
  } catch (error) {
    await rm(temporary, { force: true });
    throw error;
  }
}

async function main(): Promise<void> {
  const files = await findMigrationFiles(projectRoot);
  let changed = 0;
  let unparseable = 0;
  for (const path of files.sort()) {
    const before = await readFile(path, 'utf-8');
    const after = path.endsWith('.json') ? renameInJson(before) : renameInDts(before);
    if (after === undefined) {
      unparseable += 1;
      console.log(`NOT JSON ${relative(projectRoot, path)}`);
      continue;
    }
    if (after === before) continue;
    changed += 1;
    console.log(`${check ? 'WOULD FIX' : 'FIXED'} ${relative(projectRoot, path)}`);
    if (!check) await replaceFile(path, after);
  }
  console.log(
    `${files.length} file(s) under migrations/ scanned, ${changed} ${check ? 'need' : 'got'} the rename.`,
  );
  if (unparseable > 0) {
    console.log(`${unparseable} .json file(s) could not be parsed; check them by hand.`);
  }
  if (unparseable > 0 || (check && changed > 0)) process.exit(1);
}

void main();
