#!/usr/bin/env node
/**
 * Writes every type alias a column of a SQL contract is typed by into the column. Contracts emitted before this release store an alias as a `storage.types` entry and each column typed by it as a `typeRef` naming the entry; this release stores the alias's params on the column itself and refuses a stored `typeRef`. In each contract the script replaces every column's `typeRef` with the entry's `typeParams`, removes each entry a column named, and makes the same change in `contract.d.ts`. In a contract of the app's own contract space it also removes every entry no column names, an alias nothing uses, so the result is what a re-emit gives. In a contract of an extension's contract space, where registered database types live, it keeps such an entry and lists it. The script then renames the snapshot directories and rewrites every migration, ref, `migration.ts` and `contract.d.ts` that names an old storage hash.
 *
 * A contract belongs to an extension's contract space when a ref or migration of an extension space names its hash: one under `migrations/<space>/` other than `migrations/app/`, or one in a package's own single-space `migrations/` directory. It belongs to the app's when only refs and migrations under `migrations/app/` name it. A snapshot that nothing names keeps its unreferenced entries, as the script cannot tell whose it is. For an emitted contract that nothing names, the nearest migrations directory decides: one with an `app/` space directory, or none at all, is the app's; one with `refs/` directly in it is a package's own space.
 *
 * Usage: node expand-type-aliases.ts [project-root]
 *
 * The project root defaults to the working directory. The script reads and writes files only. It needs no database, network or configured stack, and a project with no `typeRef` and no unused alias in the app's space is left unchanged. When it stops (a file it must read is not valid JSON, a contract whose stored hash does not match its content, a column whose alias is missing or has another codec or data type, a migration with no data operation between two snapshots that become the same snapshot, or a snapshot directory that already exists with different content) it changes no file, prints one line per case and exits 1. When it finishes it prints how many files and snapshot directories it changed, each storage hash it replaced, and each entry it removed or kept.
 *
 * The storage hash and migration hash rules are copied from `@internal/contract` and `@internal/migration-tools` because a project's strict `node_modules` does not expose them.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  type Dirent,
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

type Json = null | boolean | number | string | Json[] | JsonRecord;
interface JsonRecord {
  [key: string]: Json;
}

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const APP_SPACE_ID = 'app';
const HASH = /^[0-9a-f]{64}$/;
const TEMPORARY_SUFFIX = '.expand-type-aliases-tmp';
const BYTE_ORDER_MARK = '\uFEFF';

function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function withoutByteOrderMark(text: string): string {
  return text.startsWith(BYTE_ORDER_MARK) ? text.slice(BYTE_ORDER_MARK.length) : text;
}

function parseJson(text: string): Json | undefined {
  try {
    const value: Json = JSON.parse(withoutByteOrderMark(text));
    return value;
  } catch {
    return undefined;
  }
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  const sorted: JsonRecord = {};
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    const child = value[key];
    if (child !== undefined) sorted[key] = sortKeys(child);
  }
  return sorted;
}

function canonicalizeJson(value: Json): string {
  return JSON.stringify(sortKeys(value));
}

type PathSegment = string | readonly string[];

function matchesPath(path: readonly string[], pattern: readonly PathSegment[]): boolean {
  if (path.length !== pattern.length) return false;
  return pattern.every((segment, index) => {
    const value = path[index];
    if (value === undefined) return false;
    if (segment === '*') return true;
    return typeof segment === 'string' ? value === segment : segment.includes(value);
  });
}

const SQL_PRESERVED_EMPTY: readonly (readonly PathSegment[])[] = [
  ['storage', 'namespaces', '*', 'entries', 'table'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'indexes', 'unique'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'columns', '*', 'default', 'value'],
];
const COLUMN_DEFAULT_VALUE: readonly PathSegment[] = [
  'storage',
  'namespaces',
  '*',
  'entries',
  'table',
  '*',
  'columns',
  '*',
  'default',
  'value',
];
const FRAMEWORK_PRESERVED_EMPTY: readonly (readonly PathSegment[])[] = [
  ['domain', 'namespaces'],
  ['domain', 'namespaces', '*'],
  ['domain', 'namespaces', '*', 'models'],
  ['domain', 'namespaces', '*', 'models', '*', 'relations'],
  ['domain', 'namespaces', '*', 'models', '*', 'storage'],
  ['storage', 'namespaces'],
  ['storage', 'namespaces', '*', 'entries'],
  ['roots'],
  ['extensions'],
  ['extensions', '*'],
  ['capabilities'],
  ['meta'],
  ['execution', 'mutations', 'defaults'],
];
const TOP_LEVEL_ORDER = [
  'schemaVersion',
  'canonicalVersion',
  'targetFamily',
  'target',
  'profileHash',
  'roots',
  'domain',
  'storage',
  'execution',
  'capabilities',
  'extensions',
  'defaultControlPolicy',
  'meta',
];

function isDefaultValue(value: Json): boolean {
  if (value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

function isPreservedEmpty(path: readonly string[], key: string): boolean {
  if (key === 'nullable') return true;
  if (key === 'elementNullable' && path.at(-2) === 'many') return true;
  if (FRAMEWORK_PRESERVED_EMPTY.some((pattern) => matchesPath(path, pattern))) return true;
  if (
    path.length >= COLUMN_DEFAULT_VALUE.length &&
    matchesPath(path.slice(0, COLUMN_DEFAULT_VALUE.length), COLUMN_DEFAULT_VALUE)
  )
    return true;
  return SQL_PRESERVED_EMPTY.some((pattern) => matchesPath(path, pattern));
}

function omitDefaults(value: Json, path: readonly string[]): Json {
  if (Array.isArray(value)) return value.map((item) => omitDefaults(item, path));
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (key === '_generated') continue;
    if (key === 'generated' && child === false) continue;
    if ((key === 'onDelete' || key === 'onUpdate') && child === 'noAction') continue;
    if (isDefaultValue(child) && !isPreservedEmpty(childPath, key)) continue;
    result[key] = omitDefaults(child, childPath);
  }
  return result;
}

function compareByName(a: Json, b: Json): number {
  const nameA = isRecord(a) && typeof a['name'] === 'string' ? a['name'] : '';
  const nameB = isRecord(b) && typeof b['name'] === 'string' ? b['name'] : '';
  return compareCodeUnits(nameA, nameB);
}

function sortTableArrays(storage: Json): Json {
  if (!isRecord(storage)) return storage;
  const namespaces = storage['namespaces'];
  if (!isRecord(namespaces)) return storage;
  const sortedNamespaces: JsonRecord = {};
  for (const [namespaceId, namespace] of Object.entries(namespaces)) {
    const entries = isRecord(namespace) ? namespace['entries'] : undefined;
    const tables = isRecord(entries) ? entries['table'] : undefined;
    if (!isRecord(namespace) || !isRecord(entries) || !isRecord(tables)) {
      sortedNamespaces[namespaceId] = namespace;
      continue;
    }
    const sortedTables: JsonRecord = {};
    for (const [tableName, table] of Object.entries(tables)) {
      if (!isRecord(table)) {
        sortedTables[tableName] = table;
        continue;
      }
      const sortedTable: JsonRecord = { ...table };
      for (const key of ['checks', 'indexes', 'uniques']) {
        const list = table[key];
        if (Array.isArray(list)) sortedTable[key] = [...list].sort(compareByName);
      }
      sortedTables[tableName] = sortedTable;
    }
    sortedNamespaces[namespaceId] = { ...namespace, entries: { ...entries, table: sortedTables } };
  }
  return { ...storage, namespaces: sortedNamespaces };
}

function orderTopLevel(value: JsonRecord): JsonRecord {
  const ordered: JsonRecord = {};
  const remaining = new Set(Object.keys(value));
  for (const key of TOP_LEVEL_ORDER) {
    const child = value[key];
    if (child !== undefined) {
      ordered[key] = child;
      remaining.delete(key);
    }
  }
  for (const key of [...remaining].sort(compareCodeUnits)) {
    const child = value[key];
    if (child !== undefined) ordered[key] = child;
  }
  return ordered;
}

function omitNamespaceKinds(storage: JsonRecord): JsonRecord {
  const namespaces = storage['namespaces'];
  if (!isRecord(namespaces)) return storage;
  const stripped: JsonRecord = {};
  for (const [namespaceId, namespace] of Object.entries(namespaces)) {
    if (isRecord(namespace)) {
      const { kind: _kind, ...rest } = namespace;
      stripped[namespaceId] = rest;
    } else {
      stripped[namespaceId] = namespace;
    }
  }
  return { ...storage, namespaces: stripped };
}

function computeStorageHash(contract: JsonRecord): string {
  const storage = isRecord(contract['storage']) ? contract['storage'] : {};
  const { storageHash: _published, ...withoutHash } = storage;
  const hashed: JsonRecord = {
    schemaVersion: '1',
    targetFamily: typeof contract['targetFamily'] === 'string' ? contract['targetFamily'] : '',
    target: typeof contract['target'] === 'string' ? contract['target'] : '',
    profileHash: '',
    roots: {},
    domain: { namespaces: {} },
    storage: omitNamespaceKinds(withoutHash),
    extensions: {},
    capabilities: {},
    meta: {},
  };
  const withoutDefaults = omitDefaults(hashed, []);
  if (!isRecord(withoutDefaults)) return '';
  const withSortedStorage = {
    ...withoutDefaults,
    storage: sortTableArrays(withoutDefaults['storage'] ?? {}),
  };
  const sorted = sortKeys(withSortedStorage);
  return isRecord(sorted) ? sha256(JSON.stringify(orderTopLevel(sorted), null, 2)) : '';
}

function computeMigrationHash(metadata: JsonRecord, ops: Json): string {
  const { migrationHash: _migrationHash, ...withoutHash } = metadata;
  const parts = [canonicalizeJson(withoutHash), canonicalizeJson(ops)].map(sha256);
  return sha256(canonicalizeJson(parts));
}

interface ProjectFiles {
  readonly json: readonly string[];
  readonly migrationJson: readonly string[];
  readonly refs: readonly string[];
  readonly migrationTs: readonly string[];
  readonly leftovers: readonly string[];
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function isFile(path: string): boolean {
  try {
    return statSync(path).isFile();
  } catch {
    return false;
  }
}

/** A file, or a link to one: the script reads and writes through links to files. */
function isFileEntry(dir: string, entry: Dirent): boolean {
  return entry.isFile() || (entry.isSymbolicLink() && isFile(join(dir, entry.name)));
}

/** A file the script reads, by the path it was reached through: its own path rather than a link's. */
interface FoundFile {
  readonly path: string;
  readonly linked: boolean;
  readonly inMigrationPackage: boolean;
}

function listFiles(root: string): ProjectFiles {
  const leftovers: string[] = [];
  const visited = new Set<string>();
  const found = new Map<string, FoundFile>();
  const visit = (dir: string): void => {
    const realDir = realpathSync(dir);
    if (visited.has(realDir)) return;
    visited.add(realDir);
    const entries = readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      compareCodeUnits(a.name, b.name),
    );
    const inMigrationPackage = entries.some(
      (entry) => entry.name === 'migration.json' && isFileEntry(dir, entry),
    );
    for (const entry of entries) {
      const path = join(dir, entry.name);
      if (entry.name.endsWith(TEMPORARY_SUFFIX)) {
        leftovers.push(path);
        continue;
      }
      if (entry.isDirectory() || (entry.isSymbolicLink() && isDirectory(path))) {
        if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.')) visit(path);
        continue;
      }
      if (!isFileEntry(dir, entry)) continue;
      const realFile = realpathSync(path);
      const linked = entry.isSymbolicLink();
      const known = found.get(realFile);
      if (known === undefined || (known.linked && !linked))
        found.set(realFile, { path, linked, inMigrationPackage });
    }
  };
  visit(root);
  const files = [...found.values()];
  const named = (test: (file: FoundFile, name: string) => boolean): string[] =>
    files.filter((file) => test(file, basename(file.path))).map((file) => file.path);
  return {
    json: named((_file, name) => name.endsWith('.json')),
    migrationJson: named((_file, name) => name === 'migration.json'),
    refs: named((file, name) => name.endsWith('.json') && basename(dirname(file.path)) === 'refs'),
    migrationTs: named((file, name) => name === 'migration.ts' && file.inMigrationPackage),
    leftovers,
  };
}

function isSnapshotContract(path: string): boolean {
  const snapshotDir = dirname(path);
  return (
    basename(path) === 'contract.json' &&
    HASH.test(basename(snapshotDir)) &&
    basename(dirname(snapshotDir)) === 'snapshots'
  );
}

function replaceQuotedHashes(text: string, hashes: ReadonlyMap<string, string>): string {
  return text.replace(/"([0-9a-f]{64})"/g, (match: string, hash: string) => {
    const next = hashes.get(hash);
    return next === undefined ? match : `"${next}"`;
  });
}

function readDirectory(dir: string): Map<string, string> {
  const files = new Map<string, string>();
  if (!existsSync(dir)) return files;
  for (const entry of readdirSync(dir, { withFileTypes: true }))
    if (isFileEntry(dir, entry) && !entry.name.endsWith(TEMPORARY_SUFFIX))
      files.set(entry.name, readFileSync(join(dir, entry.name), 'utf8'));
  return files;
}

function sameFiles(a: ReadonlyMap<string, string>, b: ReadonlyMap<string, string>): boolean {
  return a.size === b.size && [...a].every(([name, content]) => b.get(name) === content);
}

function temporaryPath(path: string): string {
  return join(dirname(path), `.${basename(path)}${TEMPORARY_SUFFIX}`);
}

function writeWithModeOf(path: string, text: string, modeSource: string): void {
  writeFileSync(path, text);
  if (existsSync(modeSource)) chmodSync(path, statSync(modeSource).mode & 0o7777);
}

function writeFile(path: string, text: string): void {
  const target = realpathSync(path);
  const temporary = temporaryPath(target);
  writeWithModeOf(temporary, text, target);
  renameSync(temporary, target);
}

function writeDirectory(dir: string, files: ReadonlyMap<string, string>, sourceDir: string): void {
  const temporary = temporaryPath(dir);
  mkdirSync(temporary);
  for (const [name, text] of files)
    writeWithModeOf(join(temporary, name), text, join(sourceDir, name));
  renameSync(temporary, dir);
}

function removeDirectory(dir: string): void {
  const temporary = temporaryPath(dir);
  renameSync(dir, temporary);
  rmSync(temporary, { recursive: true, force: true });
}

function count(amount: number, singular: string, plural: string): string {
  return `${amount} ${amount === 1 ? singular : plural}`;
}

const REMOVED_KEY = 'typeRef';
const DTS_LINE_WIDTH = 100;

interface Rewrite {
  readonly contract: JsonRecord;
  readonly changed: boolean;
  /** The `storage.types` entries a column referenced, whose params the rewrite wrote into the columns. */
  readonly expanded: ReadonlyMap<string, JsonRecord>;
  /** Every `storage.types` entry the rewrite removed: the referenced ones, and in the app's space the unreferenced ones too. */
  readonly removed: ReadonlySet<string>;
  /** The `storage.types` entries no column referenced, which the rewrite kept. */
  readonly kept: readonly string[];
  readonly problems: readonly string[];
}

function nonEmptyParams(entry: JsonRecord): JsonRecord | undefined {
  const params = entry['typeParams'];
  return isRecord(params) && Object.keys(params).length > 0 ? params : undefined;
}

/** The column with its `typeRef` replaced, in place, by the referenced entry's params. */
function expandedColumn(column: JsonRecord, entry: JsonRecord): JsonRecord {
  const params = nonEmptyParams(entry);
  const result: JsonRecord = {};
  for (const [key, value] of Object.entries(column)) {
    if (key !== REMOVED_KEY) result[key] = value;
    else if (params !== undefined) result['typeParams'] = params;
  }
  return result;
}

function describeType(record: JsonRecord): string {
  return `codec ${String(record['codecId'])} and data type ${String(record['dataType'])}`;
}

/** The contract with every column's type alias written into the column, the aliases it named removed from `storage.types`, and in a contract of the app's space every other entry too. */
function rewriteContract(contract: JsonRecord, space: SpaceKind): Rewrite {
  const copy = parseJson(JSON.stringify(contract));
  const storage = isRecord(copy) ? copy['storage'] : undefined;
  if (!isRecord(copy) || !isRecord(storage))
    return {
      contract,
      changed: false,
      expanded: new Map(),
      removed: new Set(),
      kept: [],
      problems: [],
    };
  const types = isRecord(storage['types']) ? storage['types'] : {};
  const expanded = new Map<string, JsonRecord>();
  const problems: string[] = [];
  let changed = false;
  const namespaces = storage['namespaces'];
  for (const namespace of isRecord(namespaces) ? Object.values(namespaces) : []) {
    const entries = isRecord(namespace) ? namespace['entries'] : undefined;
    const tables = isRecord(entries) ? entries['table'] : undefined;
    for (const [tableName, table] of isRecord(tables) ? Object.entries(tables) : []) {
      const columns = isRecord(table) ? table['columns'] : undefined;
      if (!isRecord(columns)) continue;
      for (const [columnName, column] of Object.entries(columns)) {
        if (!isRecord(column) || !Object.hasOwn(column, REMOVED_KEY)) continue;
        changed = true;
        const alias = column[REMOVED_KEY];
        const entry = typeof alias === 'string' ? types[alias] : undefined;
        const where = `column ${tableName}.${columnName}`;
        if (typeof alias !== 'string' || !isRecord(entry)) {
          problems.push(
            `${where} is typed by the type alias ${JSON.stringify(alias)}, which storage.types does not declare`,
          );
          continue;
        }
        if (Object.hasOwn(column, 'typeParams')) {
          problems.push(`${where} stores both typeRef and typeParams`);
          continue;
        }
        if (column['codecId'] !== entry['codecId'] || column['dataType'] !== entry['dataType']) {
          problems.push(
            `${where} has ${describeType(column)}, but its type alias ${alias} has ${describeType(entry)}`,
          );
          continue;
        }
        columns[columnName] = expandedColumn(column, entry);
        expanded.set(alias, entry);
      }
    }
  }
  const removed = new Set(space === 'app' ? Object.keys(types) : expanded.keys());
  for (const alias of removed) delete types[alias];
  if (removed.size > 0 && Object.keys(types).length === 0) delete storage['types'];
  const kept = Object.keys(types).sort(compareCodeUnits);
  return {
    contract: copy,
    changed: changed || removed.size > 0,
    expanded,
    removed,
    kept,
    problems,
  };
}

function withStorageHash(contract: JsonRecord, hash: string): JsonRecord {
  const storage = contract['storage'];
  if (!isRecord(storage) || typeof storage['storageHash'] !== 'string') return contract;
  return { ...contract, storage: { ...storage, storageHash: hash } };
}

function lineEndingOf(text: string): string {
  return text.includes('\r\n') ? '\r\n' : '\n';
}

/** The contract written the way the file held it: a snapshot's canonical line, or indented JSON, with the file's byte order mark and line ending. */
function writtenForm(contract: JsonRecord, original: JsonRecord, text: string): string {
  const mark = text.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  const body = withoutByteOrderMark(text);
  const lineEnding = lineEndingOf(body);
  const finalNewline = body.endsWith('\n') ? lineEnding : '';
  if (body === `${canonicalizeJson(original)}${finalNewline}`)
    return `${mark}${canonicalizeJson(contract)}${finalNewline}`;
  const indented = JSON.stringify(contract, null, 2).replaceAll('\n', lineEnding);
  return `${mark}${indented}${finalNewline}`;
}

interface Block {
  readonly start: number;
  end: number;
  readonly label: string;
  readonly parent: Block | undefined;
}

function scanBlocks(text: string): Block[] {
  const blocks: Block[] = [];
  const open: Block[] = [];
  let quote: string | undefined;
  for (let index = 0; index < text.length; index++) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === '/' && text[index + 1] === '/') {
      const end = text.indexOf('\n', index);
      index = end === -1 ? text.length : end;
      continue;
    }
    if (char === '/' && text[index + 1] === '*') {
      const end = text.indexOf('*/', index + 2);
      index = end === -1 ? text.length : end + 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '{') {
      const key =
        /(?:readonly\s+)?([\p{ID_Start}_$][\p{ID_Continue}$]*|'[^']*'|"[^"]*")\s*\??\s*:\s*$/u.exec(
          text.slice(Math.max(0, index - 200), index),
        );
      const block: Block = {
        start: index,
        end: text.length,
        label: key?.[1]?.replace(/^['"]|['"]$/g, '') ?? '',
        parent: open.at(-1),
      };
      open.push(block);
      blocks.push(block);
    } else if (char === '}') {
      const block = open.pop();
      if (block !== undefined) block.end = index;
    }
  }
  return blocks;
}

function innermostBlock(blocks: readonly Block[], position: number): Block | undefined {
  let found: Block | undefined;
  for (const block of blocks)
    if (
      block.start < position &&
      position < block.end &&
      (found === undefined || block.start > found.start)
    )
      found = block;
  return found;
}

/** Whether the block is a storage column (`namespaces.<ns>.entries.table.<table>.columns.<column>`). */
function isColumnBlock(block: Block): boolean {
  const table = block.parent?.parent;
  return (
    block.parent?.label === 'columns' &&
    table?.parent?.label === 'table' &&
    table.parent.parent?.label === 'entries'
  );
}

function childBlocks(blocks: readonly Block[], parent: Block): Block[] {
  return blocks.filter((block) => block.parent === parent);
}

/** The `readonly types` block of the storage type: the one whose parent also holds `namespaces`. */
function storageTypesBlock(blocks: readonly Block[]): Block | undefined {
  return blocks.find(
    (block) =>
      block.label === 'types' &&
      block.parent !== undefined &&
      childBlocks(blocks, block.parent).some((sibling) => sibling.label === 'namespaces'),
  );
}

function lineStart(text: string, position: number): number {
  return text.lastIndexOf('\n', position - 1) + 1;
}

/** The end of the member a block closes: past its `;` and the line break after it. */
function memberEnd(text: string, block: Block): number {
  const rest = /^\s*;?[ \t]*(?:\r?\n)?/.exec(text.slice(block.end + 1));
  return block.end + 1 + (rest?.[0].length ?? 0);
}

function indentOf(text: string, position: number): string {
  return /^[ \t]*/.exec(text.slice(lineStart(text, position)))?.[0] ?? '';
}

/** Splits `{ a; b }` into its top-level members. */
function topLevelMembers(literal: string): string[] {
  const inner = literal.trim().slice(1, -1);
  const members: string[] = [];
  let depth = 0;
  let quote: string | undefined;
  let current = '';
  for (let index = 0; index < inner.length; index++) {
    const char = inner[index] ?? '';
    current += char;
    if (quote !== undefined) {
      if (char === '\\') current += inner[++index] ?? '';
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '{' || char === '[' || char === '(') depth++;
    else if (char === '}' || char === ']' || char === ')') depth--;
    else if (char === ';' && depth === 0) {
      members.push(current.slice(0, -1).trim());
      current = '';
    }
  }
  if (current.trim() !== '') members.push(current.trim());
  return members;
}

/** The `readonly typeParams` member, laid out as the emitter's formatter lays it out at `indent`. */
function typeParamsMember(literal: string, indent: string, lineEnding: string): string {
  const lines = literal.split('\n');
  const head = `${indent}readonly typeParams: `;
  if (lines.length > 1) {
    const literalIndent = /^[ \t]*/.exec(lines.at(-1) ?? '')?.[0] ?? '';
    const shifted = lines.map((line, index) =>
      index === 0 ? line : `${indent}${line.slice(literalIndent.length)}`,
    );
    return `${head}${shifted.join('\n')};`;
  }
  const single = `${head}${literal};`;
  if (single.length <= DTS_LINE_WIDTH) return single;
  const members = topLevelMembers(literal).map((member) => `${indent}  ${member};`);
  return `${head}{${lineEnding}${members.join(lineEnding)}${lineEnding}${indent}};`;
}

/** The text of `typeParams` in an entry block of `readonly types`, as the emitter wrote it. */
function entryParamsLiteral(
  text: string,
  blocks: readonly Block[],
  entry: Block,
): string | undefined {
  const params = childBlocks(blocks, entry).find((block) => block.label === 'typeParams');
  return params === undefined ? undefined : text.slice(params.start, params.end + 1);
}

function jsonParamsLiteral(params: JsonRecord): string {
  const members = Object.entries(params).map(
    ([key, value]) =>
      `readonly ${/^[A-Za-z_$][\w$]*$/.test(key) ? key : `'${key}'`}: ${JSON.stringify(value)}`,
  );
  return `{ ${members.join('; ')} }`;
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function rewriteDts(
  text: string,
  expanded: ReadonlyMap<string, JsonRecord>,
  removedEntries: ReadonlySet<string>,
  hashes: ReadonlyMap<string, string>,
): string {
  const lineEnding = lineEndingOf(text);
  const blocks = scanBlocks(text);
  const typesBlock = storageTypesBlock(blocks);
  const entryBlocks = typesBlock === undefined ? [] : childBlocks(blocks, typesBlock);
  const literals = new Map<string, string>();
  for (const [alias, entry] of expanded) {
    const params = nonEmptyParams(entry);
    if (params === undefined) continue;
    const block = entryBlocks.find((candidate) => candidate.label === alias);
    literals.set(
      alias,
      (block === undefined ? undefined : entryParamsLiteral(text, blocks, block)) ??
        jsonParamsLiteral(params),
    );
  }
  const edits: Edit[] = [];
  for (const match of text.matchAll(/readonly typeRef:\s*(?:'([^']*)'|"([^"]*)")\s*;?/g)) {
    const alias = match[1] ?? match[2] ?? '';
    const column = innermostBlock(blocks, match.index);
    if (column === undefined || !isColumnBlock(column) || !expanded.has(alias)) continue;
    const start = lineStart(text, match.index);
    const literal = literals.get(alias);
    if (literal === undefined) {
      const end = match.index + match[0].length;
      const lineBreak = /^\r?\n/.exec(text.slice(end))?.[0] ?? '';
      edits.push({ start, end: end + lineBreak.length, text: '' });
    } else {
      edits.push({
        start,
        end: match.index + match[0].length,
        text: typeParamsMember(literal, indentOf(text, match.index), lineEnding),
      });
    }
  }
  if (typesBlock !== undefined) {
    const removed = entryBlocks.filter((block) => removedEntries.has(block.label));
    if (removed.length > 0 && removed.length === entryBlocks.length) {
      edits.push({
        start: lineStart(text, typesBlock.start),
        end: memberEnd(text, typesBlock),
        text: '',
      });
    } else {
      for (const block of removed)
        edits.push({ start: lineStart(text, block.start), end: memberEnd(text, block), text: '' });
    }
  }
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  return replaceHashTokens(result, hashes);
}

function replaceHashTokens(text: string, hashes: ReadonlyMap<string, string>): string {
  return text.replace(
    /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/g,
    (hash: string) => hashes.get(hash) ?? hash,
  );
}

interface ContractPlan {
  readonly path: string;
  readonly snapshot: boolean;
  readonly oldHash: string;
  readonly newHash: string;
  readonly content: string;
  readonly expanded: ReadonlyMap<string, JsonRecord>;
  readonly removed: ReadonlySet<string>;
  readonly kept: readonly string[];
}

/** Whose contract space a contract is: the app's own; an extension's, which registers database types; or unknown, for a snapshot no migration or ref names. Only a contract of the app's space loses the entries no column references. */
type SpaceKind = 'app' | 'extension' | 'unknown';

/** A hash a migration or ref names, and the space whose directory holds it. */
interface HashReference {
  readonly path: string;
  readonly space: SpaceKind;
  readonly hashes: readonly string[];
  /** A migration's `from` and `to`; `undefined` for a ref. */
  readonly edge: { readonly from: string; readonly to: string } | undefined;
}

/** The space of the directory that holds a migration package or a `refs` directory: `migrations/app` is the app's; any other space directory, or a package's own single-space `migrations`, an extension's. */
function spaceOfDirectory(spaceDir: string): SpaceKind {
  return basename(spaceDir) === APP_SPACE_ID ? 'app' : 'extension';
}

function hashReferences(files: ProjectFiles): HashReference[] {
  const references: HashReference[] = [];
  for (const path of files.migrationJson) {
    const metadata = parseJson(readFileSync(path, 'utf8'));
    if (!isRecord(metadata)) continue;
    const from = metadata['from'];
    const to = metadata['to'];
    const hashes = [from, to].filter((hash): hash is string => typeof hash === 'string');
    references.push({
      path: dirname(path),
      space: spaceOfDirectory(dirname(dirname(path))),
      hashes,
      edge: typeof from === 'string' && typeof to === 'string' ? { from, to } : undefined,
    });
  }
  for (const path of files.refs) {
    const ref = parseJson(readFileSync(path, 'utf8'));
    const hash = isRecord(ref) ? ref['hash'] : undefined;
    if (typeof hash !== 'string') continue;
    references.push({
      path,
      space: spaceOfDirectory(dirname(dirname(path))),
      hashes: [hash],
      edge: undefined,
    });
  }
  return references;
}

/** The space of a migrations directory, by its layout: an `app` space directory, or no `refs` directly in it, is the app's. */
function spaceOfMigrationsDirectory(dir: string): SpaceKind {
  if (isDirectory(join(dir, APP_SPACE_ID))) return 'app';
  return isDirectory(join(dir, 'refs')) ? 'extension' : 'app';
}

/** The space of a contract that no ref or migration names: unknown for a snapshot, as every space shares the snapshot store; for an emitted contract, that of the nearest `migrations` directory above it, or the app's when there is none. */
function spaceByLayout(path: string, snapshot: boolean, root: string): SpaceKind {
  if (snapshot) return 'unknown';
  for (let dir = dirname(path); ; dir = dirname(dir)) {
    const migrations = join(dir, 'migrations');
    if (isDirectory(migrations)) return spaceOfMigrationsDirectory(migrations);
    if (dir === root || dirname(dir) === dir) return 'app';
  }
}

function summary(
  root: string,
  contractsFound: number,
  files: number,
  directories: number,
  hashes: ReadonlyMap<string, string>,
  removed: readonly (readonly [string, readonly string[]])[],
  kept: readonly (readonly [string, readonly string[]])[],
): readonly string[] {
  if (contractsFound === 0) return [`No SQL contract was found under ${root}; nothing changed.`];
  if (files === 0 && directories === 0)
    return ['No contract stores a type alias; nothing changed.'];
  const renamed = count(directories, 'snapshot directory', 'snapshot directories');
  const changes = `Rewrote ${count(files, 'file', 'files')} and renamed ${renamed}.`;
  const listed = (entries: readonly (readonly [string, readonly string[]])[]) =>
    entries.map(([path, names]) => `  ${path}: ${names.join(', ')}`);
  return [
    ...(hashes.size === 0
      ? [changes]
      : [
          `${changes} Storage hashes changed (old -> new):`,
          ...[...hashes]
            .sort(([a], [b]) => compareCodeUnits(a, b))
            .map(([oldHash, newHash]) => `  ${oldHash} -> ${newHash}`),
        ]),
    ...(removed.length === 0 ? [] : ['Removed storage.types entries:', ...listed(removed)]),
    ...(kept.length === 0
      ? []
      : [
          "Kept storage.types entries that no column references, in contracts of an extension's contract space and in snapshots that no migration or ref names. Each is a database type a contract space registers, or a type alias nothing uses:",
          ...listed(kept),
        ]),
  ];
}

/** Each path with the names listed for it, merged and sorted, in path order. */
function byPath(
  entries: readonly (readonly [string, readonly string[]])[],
): (readonly [string, readonly string[]])[] {
  const merged = new Map<string, Set<string>>();
  for (const [path, names] of entries)
    merged.set(path, new Set([...(merged.get(path) ?? []), ...names]));
  return [...merged]
    .map(([path, names]): readonly [string, readonly string[]] => [
      path,
      [...names].sort(compareCodeUnits),
    ])
    .sort(([a], [b]) => compareCodeUnits(a, b));
}

interface MigrationOps {
  readonly path: string;
  /** `undefined` when the package has no `ops.json` or it is not valid JSON. */
  readonly ops: Json | undefined;
  readonly unreadable: boolean;
}

function readOps(migrationDir: string): MigrationOps {
  const path = join(migrationDir, 'ops.json');
  if (!existsSync(path)) return { path, ops: undefined, unreadable: false };
  const ops = parseJson(readFileSync(path, 'utf8'));
  return { path, ops, unreadable: ops === undefined };
}

/** Whether the operations hold one of class `data`, the one kind that lets a migration go from a snapshot to itself. The migration checker's rule (`checkIntegrity` in `@internal/migration-tools`). */
function hasDataOperation(ops: Json | undefined): boolean {
  return Array.isArray(ops) && ops.some((op) => isRecord(op) && op['operationClass'] === 'data');
}

/**
 * The snapshot directories that the rewrite turns two or more snapshots into, and a stop line for each migration between such snapshots that has no data operation, naming too each of its snapshots that nothing else names, or, when its `ops.json` is not valid JSON, for that file. Expanding the aliases can make two contracts equal: one that wrote a type inline and one that wrote it through an alias, or two that named one alias differently. A migration between them then goes from a snapshot to itself, which the migration checker allows only for a migration with a data operation. A snapshot nothing names, such as a copy an interrupted run left, is not counted.
 */
function mergedSnapshots(
  files: ProjectFiles,
  plans: readonly ContractPlan[],
  references: readonly HashReference[],
  display: (path: string) => string,
): { readonly lines: readonly string[]; readonly directories: ReadonlySet<string> } {
  const planned = new Map(plans.map((plan) => [plan.path, plan.newHash]));
  const referenced = new Set(references.flatMap((reference) => reference.hashes));
  const stores = new Map<string, Map<string, Set<string>>>();
  for (const path of files.json) {
    if (!isSnapshotContract(path)) continue;
    const hash = basename(dirname(path));
    if (!referenced.has(hash)) continue;
    const store = dirname(dirname(path));
    const merged = stores.get(store) ?? new Map<string, Set<string>>();
    stores.set(store, merged);
    const newHash = planned.get(path) ?? hash;
    merged.set(newHash, new Set([...(merged.get(newHash) ?? []), hash]));
  }
  const lines: string[] = [];
  const directories = new Set<string>();
  for (const [store, merged] of stores) {
    for (const [newHash, oldHashes] of merged) {
      if (oldHashes.size < 2) continue;
      directories.add(join(store, newHash));
      const names = [...oldHashes].sort(compareCodeUnits).join(' and ');
      for (const { path, edge } of references) {
        if (
          edge === undefined ||
          edge.from === edge.to ||
          !oldHashes.has(edge.from) ||
          !oldHashes.has(edge.to) ||
          !path.startsWith(`${dirname(store)}${sep}`)
        )
          continue;
        const ops = readOps(path);
        if (ops.unreadable) {
          lines.push(`${display(ops.path)}: not valid JSON`);
          continue;
        }
        if (hasDataOperation(ops.ops)) continue;
        const orphaned = [edge.from, edge.to].filter(
          (hash) => !references.some((other) => other.path !== path && other.hashes.includes(hash)),
        );
        const snapshots = orphaned.map((hash) => display(join(store, hash)));
        const toDelete =
          snapshots.length === 0
            ? `the migration directory ${display(path)}`
            : `the migration directory ${display(path)} and the snapshot ${snapshots.length === 1 ? 'directory' : 'directories'} ${snapshots.join(' and ')}, which no other migration or ref names,`;
        lines.push(
          `${display(store)}: the snapshots ${names} become the same snapshot, ${newHash}, once their type aliases are written into their columns. Migration ${display(path)} goes from ${edge.from} to ${edge.to} and has no data operation, so it would go from ${newHash} to itself, which only a migration with a data operation may do. Delete ${toDelete} and run the script again.`,
        );
      }
    }
  }
  return { lines, directories };
}

const JSON_FILES_THAT_MUST_PARSE = new Set(['contract.json', 'migration.json']);

function parseRoot(args: readonly string[]): { readonly root: string; readonly errors: string[] } {
  const errors = args.filter((arg) => arg.startsWith('-')).map((arg) => `${arg}: unknown option`);
  const positional = args.filter((arg) => !arg.startsWith('-'));
  if (positional.length > 1) errors.push(`expected one project root, got ${positional.length}`);
  const root = resolve(positional[0] ?? process.cwd());
  if (errors.length === 0 && !isDirectory(root)) errors.push(`${root}: not a directory`);
  if (errors.length > 0) errors.push('Usage: node expand-type-aliases.ts [project-root]');
  return { root, errors };
}

function main({
  root,
  errors,
}: {
  readonly root: string;
  readonly errors: readonly string[];
}): number {
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    return 1;
  }
  const display = (path: string): string => relative(root, path).split(sep).join('/');
  const files = listFiles(root);
  const references = hashReferences(files);
  const spacesByHash = new Map<string, Set<SpaceKind>>();
  for (const reference of references)
    for (const hash of reference.hashes)
      spacesByHash.set(hash, new Set([...(spacesByHash.get(hash) ?? []), reference.space]));
  const spaceOf = (path: string, snapshot: boolean, hash: string): SpaceKind => {
    const spaces = spacesByHash.get(hash);
    if (spaces?.has('extension')) return 'extension';
    if (spaces?.has('app')) return 'app';
    return spaceByLayout(path, snapshot, root);
  };
  const plans: ContractPlan[] = [];
  const stops: string[] = [];
  let contractsFound = 0;

  for (const path of files.json) {
    const text = readFileSync(path, 'utf8');
    const contract = parseJson(text);
    if (
      contract === undefined &&
      (JSON_FILES_THAT_MUST_PARSE.has(basename(path)) || files.refs.includes(path))
    ) {
      stops.push(`${display(path)}: not valid JSON`);
      continue;
    }
    if (
      !isRecord(contract) ||
      contract['targetFamily'] !== 'sql' ||
      typeof contract['target'] !== 'string' ||
      !isRecord(contract['storage'])
    )
      continue;
    contractsFound++;
    const snapshot = isSnapshotContract(path);
    const stored = contract['storage']['storageHash'];
    const oldHash = snapshot ? basename(dirname(path)) : typeof stored === 'string' ? stored : '';
    const rewrite = rewriteContract(contract, spaceOf(path, snapshot, oldHash));
    if (!rewrite.changed) continue;
    const computed = computeStorageHash(contract);
    if (computed !== oldHash || (typeof stored === 'string' && stored !== oldHash)) {
      stops.push(
        `${display(path)}: the stored storage hash ${oldHash} does not match the contract's content, which hashes to ${computed}; restore the file from version control, or re-emit it, and run the script again`,
      );
      continue;
    }
    if (rewrite.problems.length > 0) {
      for (const problem of rewrite.problems)
        stops.push(
          `${display(path)}: ${problem}; restore the file from version control, or re-emit it, and run the script again`,
        );
      continue;
    }
    const newHash = computeStorageHash(rewrite.contract);
    plans.push({
      path,
      snapshot,
      oldHash,
      newHash,
      content: writtenForm(withStorageHash(rewrite.contract, newHash), contract, text),
      expanded: rewrite.expanded,
      removed: rewrite.removed,
      kept: rewrite.kept,
    });
  }

  const hashes = new Map<string, string>();
  for (const plan of [...plans].sort((a, b) => Number(b.snapshot) - Number(a.snapshot)))
    if (plan.oldHash !== plan.newHash && !hashes.has(plan.oldHash))
      hashes.set(plan.oldHash, plan.newHash);
  const merged = mergedSnapshots(files, plans, references, display);
  stops.push(...merged.lines);

  const newDirectories = new Map<string, Map<string, string>>();
  const directorySources = new Map<string, string>();
  const sourceDirectories = new Set<string>();
  const removals = new Set<string>();
  const snapshotRewrites: [string, string][] = [];
  const referenceWrites = new Map<string, string>();
  const contractWrites = new Map<string, string>();
  const kept: [string, readonly string[]][] = [];
  const removedEntries: [string, readonly string[]][] = [];
  for (const plan of plans) {
    const dtsPath = plan.snapshot
      ? join(dirname(plan.path), 'contract.d.ts')
      : `${plan.path.slice(0, -'.json'.length)}.d.ts`;
    const dtsHashes = new Map([...hashes, [plan.oldHash, plan.newHash]]);
    const dts = existsSync(dtsPath)
      ? rewriteDts(readFileSync(dtsPath, 'utf8'), plan.expanded, plan.removed, dtsHashes)
      : undefined;
    const writtenPath = plan.snapshot
      ? join(dirname(dirname(plan.path)), plan.newHash, 'contract.json')
      : plan.path;
    if (plan.kept.length > 0) kept.push([display(writtenPath), plan.kept]);
    if (plan.removed.size > 0) removedEntries.push([display(writtenPath), [...plan.removed]]);
    if (!plan.snapshot) {
      if (dts !== undefined) referenceWrites.set(dtsPath, dts);
      contractWrites.set(plan.path, plan.content);
      continue;
    }
    const oldDir = dirname(plan.path);
    const newDir = join(dirname(oldDir), plan.newHash);
    sourceDirectories.add(oldDir);
    if (newDir === oldDir) {
      if (dts !== undefined) snapshotRewrites.push([dtsPath, dts]);
      snapshotRewrites.push([plan.path, plan.content]);
      continue;
    }
    removals.add(oldDir);
    const content = readDirectory(oldDir);
    content.set('contract.json', plan.content);
    if (dts !== undefined) content.set('contract.d.ts', dts);
    const planned = newDirectories.get(newDir);
    if (planned !== undefined && !sameFiles(planned, content)) {
      if (!merged.directories.has(newDir))
        stops.push(`${display(newDir)}: snapshot directory already exists with different content`);
      continue;
    }
    newDirectories.set(newDir, content);
    directorySources.set(newDir, oldDir);
  }
  for (const [dir, content] of newDirectories) {
    if (sourceDirectories.has(dir) || !existsSync(dir)) continue;
    if (merged.directories.has(dir) || sameFiles(readDirectory(dir), content))
      newDirectories.delete(dir);
    else stops.push(`${display(dir)}: snapshot directory already exists with different content`);
  }

  for (const path of files.migrationJson) {
    const text = readFileSync(path, 'utf8');
    const metadata = parseJson(text);
    if (!isRecord(metadata)) continue;
    const from = metadata['from'];
    const to = metadata['to'];
    const nextFrom = typeof from === 'string' ? (hashes.get(from) ?? from) : from;
    const nextTo = typeof to === 'string' ? (hashes.get(to) ?? to) : to;
    if (nextFrom === from && nextTo === to) continue;
    const { path: opsPath, ops, unreadable } = readOps(dirname(path));
    if (unreadable) {
      stops.push(`${display(opsPath)}: not valid JSON`);
      continue;
    }
    const oldMigrationHash = metadata['migrationHash'];
    let next = replaceQuotedHashes(text, hashes);
    if (
      ops !== undefined &&
      typeof oldMigrationHash === 'string' &&
      nextFrom !== undefined &&
      nextTo !== undefined
    ) {
      const migrationHash = computeMigrationHash({ ...metadata, from: nextFrom, to: nextTo }, ops);
      next = next.replace(`"${oldMigrationHash}"`, `"${migrationHash}"`);
    }
    referenceWrites.set(path, next);
  }
  for (const path of files.refs) {
    const text = readFileSync(path, 'utf8');
    const next = replaceQuotedHashes(text, hashes);
    if (next !== text) referenceWrites.set(path, next);
  }
  for (const path of files.migrationTs) {
    const text = readFileSync(path, 'utf8');
    const next = replaceHashTokens(text, hashes);
    if (next !== text) referenceWrites.set(path, next);
  }

  if (stops.length > 0) {
    process.stderr.write(`${[...new Set(stops)].join('\n')}\n`);
    return 1;
  }

  try {
    for (const path of files.leftovers) rmSync(path, { recursive: true, force: true });
    for (const [dir, content] of newDirectories)
      writeDirectory(dir, content, directorySources.get(dir) ?? dir);
    for (const [path, text] of snapshotRewrites) writeFile(path, text);
    for (const [path, text] of referenceWrites) writeFile(path, text);
    for (const [path, text] of contractWrites) writeFile(path, text);
    for (const dir of removals) removeDirectory(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${message}; the upgrade stopped partway, run the script again to finish it\n`,
    );
    return 1;
  }
  const rewrittenFiles = snapshotRewrites.length + referenceWrites.size + contractWrites.size;
  const lines = summary(
    root,
    contractsFound,
    rewrittenFiles,
    removals.size,
    hashes,
    byPath(removedEntries),
    byPath(kept),
  );
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = main(parseRoot(process.argv.slice(2)));
