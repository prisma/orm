#!/usr/bin/env node
/**
 * Rewrites every stored SQLite contract in a project to this release's form: a column or named type
 * of `sqlite/datetime@1` or `sqlite/json@1` names its own data type (`sqlite/datetime`,
 * `sqlite/json`) instead of `sqlite/text`, and a datetime default or enum value is written with
 * exactly three fraction digits (`2024-01-01T00:00:00.000Z`). It then renames the snapshot
 * directories and rewrites every migration, ref, `migration.ts` and `contract.d.ts` that names an
 * old storage hash.
 *
 * Usage: node data-type-values.ts [project-root]
 *
 * The project root defaults to the working directory. The script reads and writes files only. It
 * needs no database, network or configured stack, and a project already in the new form is left
 * unchanged. When it stops (a file that must be JSON is not, or a snapshot directory that already
 * exists with different content) it changes no file, prints one line per case and exits 1. When it
 * finishes it prints how many files and snapshot directories it changed and each storage hash it
 * replaced.
 *
 * The storage hash and migration hash rules are copied from `@internal/contract` and
 * `@internal/migration-tools` because a project's strict `node_modules` does not expose them.
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

const DATA_TYPES: Readonly<Record<string, string>> = {
  'sqlite/datetime@1': 'sqlite/datetime',
  'sqlite/json@1': 'sqlite/json',
};
const DATETIME_CODEC = 'sqlite/datetime@1';
const PREVIOUS_DATA_TYPE = 'sqlite/text';
const UTC_INSTANT = /^(.*:\d{2})(?:\.(\d{1,3}))?Z$/;
const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const HASH = /^[0-9a-f]{64}$/;
const TEMPORARY_SUFFIX = '.data-type-values-tmp';

function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function parseJson(text: string): Json | undefined {
  try {
    const value: Json = JSON.parse(text);
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
const COLUMN_PATHS: readonly (readonly PathSegment[])[] = [
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'columns', '*'],
  ['storage', 'namespaces', '*', 'tables', '*', 'columns', '*'],
];
const DATA_TYPE_PATHS: readonly (readonly PathSegment[])[] = [
  ...COLUMN_PATHS,
  ['storage', 'types', '*'],
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

function mapRecord(value: Json, map: (key: string, child: Json) => Json): Json {
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) result[key] = map(key, child);
  return result;
}

function mapEntries(
  value: Json,
  path: readonly string[],
  patterns: readonly (readonly PathSegment[])[],
  rewrite: (entry: JsonRecord, path: readonly string[]) => JsonRecord,
): Json {
  if (!isRecord(value)) return value;
  if (patterns.some((pattern) => matchesPath(path, pattern))) return rewrite(value, path);
  const leadsToEntry = patterns.some(
    (pattern) => path.length < pattern.length && matchesPath(path, pattern.slice(0, path.length)),
  );
  return leadsToEntry
    ? mapRecord(value, (key, child) => mapEntries(child, [...path, key], patterns, rewrite))
    : value;
}

function mapContractEntries(
  contract: JsonRecord,
  patterns: readonly (readonly PathSegment[])[],
  rewrite: (entry: JsonRecord, path: readonly string[]) => JsonRecord,
): JsonRecord {
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(contract))
    result[key] = mapEntries(child, [key], patterns, rewrite);
  return result;
}

function enumKey(namespaceId: string, name: string): string {
  return `${namespaceId}\u0000${name}`;
}

function withStorageHash(contract: JsonRecord, hash: string): JsonRecord {
  const storage = isRecord(contract['storage']) ? contract['storage'] : {};
  return { ...contract, storage: { ...storage, storageHash: hash } };
}

function emittedForm(contract: JsonRecord, original: string): string {
  const { _generated: generated, ...rest } = contract;
  const sorted = sortKeys(rest);
  const ordered = isRecord(sorted) ? orderTopLevel(sorted) : {};
  if (generated !== undefined) ordered['_generated'] = generated;
  return `${JSON.stringify(ordered, null, 2)}${original.endsWith('\n') ? '\n' : ''}`;
}

function snapshotForm(contract: JsonRecord): string {
  return `${canonicalizeJson(contract)}\n`;
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
  for (const block of blocks) {
    if (
      block.start < position &&
      position < block.end &&
      (found === undefined || block.start > found.start)
    )
      found = block;
  }
  return found;
}

function isColumnBlock(block: Block): boolean {
  return block.parent?.label === 'columns';
}

function isStorageTypeBlock(blocks: readonly Block[], block: Block): boolean {
  const types = block.parent;
  return (
    types?.label === 'types' &&
    blocks.some((other) => other.parent === types.parent && other.label === 'namespaces')
  );
}

function isInColumnDefault(block: Block): boolean {
  for (let ancestor = block.parent; ancestor !== undefined; ancestor = ancestor.parent)
    if (
      ancestor.label === 'default' &&
      ancestor.parent !== undefined &&
      isColumnBlock(ancestor.parent)
    )
      return true;
  return false;
}

function holdsDataType(blocks: readonly Block[], block: Block): boolean {
  return (isColumnBlock(block) || isStorageTypeBlock(blocks, block)) && !isInColumnDefault(block);
}

function genericArgumentEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '{' || char === '[' || char === '(' || char === '<') depth++;
    else if (char === '}' || char === ']' || char === ')') depth--;
    else if (char === '>') {
      if (depth === 0) return index;
      depth--;
    }
  }
  return text.length;
}

function memberOf(
  text: string,
  blocks: readonly Block[],
  block: Block,
  name: string,
): string | undefined {
  const pattern = new RegExp(`readonly ${name}: (['"])((?:\\\\.|(?!\\1).)*)\\1`, 'g');
  for (const member of text.slice(block.start, block.end).matchAll(pattern)) {
    if (innermostBlock(blocks, block.start + member.index) === block) return member[2];
  }
  return undefined;
}

/** The end of the type literal that starts at `start`: the first `;`, `,` or closing bracket outside it. */
function literalEnd(text: string, start: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '{' || char === '[' || char === '(' || char === '<') depth++;
    else if (char === '}' || char === ']' || char === ')' || char === '>') {
      if (depth === 0) return index;
      depth--;
    } else if ((char === ';' || char === ',') && depth === 0) return index;
  }
  return text.length;
}

function bracketEnd(text: string, open: number): number {
  let depth = 0;
  let quote: string | undefined;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '[' || char === '{' || char === '(') depth++;
    else if (char === ']' || char === '}' || char === ')') {
      depth--;
      if (depth === 0) return index + 1;
    }
  }
  return text.length;
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

function summary(
  root: string,
  contractsFound: number,
  files: number,
  directories: number,
  hashes: ReadonlyMap<string, string>,
): readonly string[] {
  if (contractsFound === 0) return [`No SQLite contract was found under ${root}; nothing changed.`];
  if (files === 0 && directories === 0)
    return ['The project is already in the new form; nothing changed.'];
  const renamed = count(directories, 'snapshot directory', 'snapshot directories');
  const changes = `Rewrote ${count(files, 'file', 'files')} and renamed ${renamed}.`;
  if (hashes.size === 0) return [changes];
  return [
    `${changes} Storage hashes changed (old -> new):`,
    ...[...hashes]
      .sort(([a], [b]) => compareCodeUnits(a, b))
      .map(([oldHash, newHash]) => `  ${oldHash} -> ${newHash}`),
  ];
}

/** The text `sqlite/datetime` stores for an instant the previous release stored: three fraction digits, always. */
function storedDatetime(value: Json): Json {
  if (typeof value !== 'string') return value;
  const match = UTC_INSTANT.exec(value);
  return match === null ? value : `${match[1]}.${(match[2] ?? '').padEnd(3, '0')}Z`;
}

function storedDatetimes(value: Json): Json {
  return Array.isArray(value) ? value.map(storedDatetime) : storedDatetime(value);
}

interface Rewrite {
  readonly contract: JsonRecord;
  readonly changed: boolean;
  readonly datetimeEnums: ReadonlySet<string>;
}

/**
 * A `sqlite/datetime@1` enum's members in the domain, and the storage value set its columns name,
 * hold instants, so they are written as `sqlite/datetime` stores them too.
 */
function rewriteDatetimeEnums(contract: JsonRecord): Rewrite {
  const datetimeEnums = new Set<string>();
  let changed = false;
  const rewritten = (values: readonly Json[]): Json[] => {
    const next = values.map(storedDatetime);
    if (canonicalizeJson(next) !== canonicalizeJson([...values])) changed = true;
    return next;
  };

  const domain = mapRecord(contract['domain'] ?? null, (key, namespaces) =>
    key !== 'namespaces'
      ? namespaces
      : mapRecord(namespaces, (namespaceId, namespace) =>
          mapRecord(namespace, (kind, enums) =>
            kind !== 'enum'
              ? enums
              : mapRecord(enums, (name, enumType) => {
                  const members = isRecord(enumType) ? enumType['members'] : undefined;
                  if (
                    !isRecord(enumType) ||
                    enumType['codecId'] !== DATETIME_CODEC ||
                    !Array.isArray(members)
                  )
                    return enumType;
                  datetimeEnums.add(enumKey(namespaceId, name));
                  const values = rewritten(
                    members.map((member) => (isRecord(member) ? (member['value'] ?? null) : null)),
                  );
                  return {
                    ...enumType,
                    members: members.map((member, index) =>
                      isRecord(member) && member['value'] !== undefined
                        ? { ...member, value: values[index] ?? null }
                        : member,
                    ),
                  };
                }),
          ),
        ),
  );

  const storage = contract['storage'];
  const namespaces = isRecord(storage) ? storage['namespaces'] : undefined;
  for (const namespace of isRecord(namespaces) ? Object.values(namespaces) : []) {
    const entries = isRecord(namespace) ? namespace['entries'] : undefined;
    const tables = isRecord(entries) ? entries['table'] : undefined;
    for (const table of isRecord(tables) ? Object.values(tables) : []) {
      const columns = isRecord(table) ? table['columns'] : undefined;
      for (const column of isRecord(columns) ? Object.values(columns) : []) {
        const valueSet = isRecord(column) ? column['valueSet'] : undefined;
        if (
          isRecord(column) &&
          column['codecId'] === DATETIME_CODEC &&
          isRecord(valueSet) &&
          typeof valueSet['namespaceId'] === 'string' &&
          typeof valueSet['entityName'] === 'string'
        )
          datetimeEnums.add(enumKey(valueSet['namespaceId'], valueSet['entityName']));
      }
    }
  }

  const nextStorage = mapRecord(storage ?? null, (key, storageNamespaces) =>
    key !== 'namespaces'
      ? storageNamespaces
      : mapRecord(storageNamespaces, (namespaceId, namespace) =>
          mapRecord(namespace, (namespaceKey, entries) =>
            namespaceKey !== 'entries'
              ? entries
              : mapRecord(entries, (entryKind, valueSets) =>
                  entryKind !== 'valueSet'
                    ? valueSets
                    : mapRecord(valueSets, (name, valueSet) => {
                        const values = isRecord(valueSet) ? valueSet['values'] : undefined;
                        if (
                          !datetimeEnums.has(enumKey(namespaceId, name)) ||
                          !isRecord(valueSet) ||
                          !Array.isArray(values)
                        )
                          return valueSet;
                        return { ...valueSet, values: rewritten(values) };
                      }),
                ),
          ),
        ),
  );

  return {
    contract: {
      ...contract,
      ...(contract['domain'] === undefined ? {} : { domain }),
      ...(storage === undefined ? {} : { storage: nextStorage }),
    },
    changed,
    datetimeEnums,
  };
}

function rewriteContract(contract: JsonRecord): Rewrite {
  if (contract['target'] !== 'sqlite')
    return { contract, changed: false, datetimeEnums: new Set() };
  let changed = false;
  const rewriteEntry = (entry: JsonRecord): JsonRecord => {
    const codecId = entry['codecId'];
    const dataType = typeof codecId === 'string' ? DATA_TYPES[codecId] : undefined;
    if (dataType === undefined) return entry;
    let next = entry;
    if (entry['dataType'] === PREVIOUS_DATA_TYPE) {
      next = { ...next, dataType };
      changed = true;
    }
    const columnDefault = next['default'];
    if (
      codecId === DATETIME_CODEC &&
      isRecord(columnDefault) &&
      columnDefault['kind'] === 'literal' &&
      columnDefault['value'] !== undefined
    ) {
      const value = storedDatetimes(columnDefault['value']);
      if (canonicalizeJson(value) !== canonicalizeJson(columnDefault['value'])) {
        next = { ...next, default: { ...columnDefault, value } };
        changed = true;
      }
    }
    return next;
  };
  const enums = rewriteDatetimeEnums(mapContractEntries(contract, DATA_TYPE_PATHS, rewriteEntry));
  return {
    contract: enums.contract,
    changed: changed || enums.changed,
    datetimeEnums: enums.datetimeEnums,
  };
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

/** The quoted instants between `start` and `end`, each written as `sqlite/datetime` stores it. */
function datetimeEdits(text: string, start: number, end: number): Edit[] {
  const edits: Edit[] = [];
  for (const match of text.slice(start, end).matchAll(/(['"])((?:\\.|(?!\1).)*)\1/g)) {
    const value = match[2] ?? '';
    const stored = storedDatetime(value);
    if (stored === value) continue;
    const at = start + match.index + 1;
    edits.push({ start: at, end: at + value.length, text: String(stored) });
  }
  return edits;
}

function rewriteDts(
  text: string,
  datetimeEnums: ReadonlySet<string>,
  hashes: ReadonlyMap<string, string>,
): string {
  const blocks = scanBlocks(text);
  const edits: Edit[] = [];

  for (const match of text.matchAll(/readonly dataType: (['"])sqlite\/text\1/g)) {
    const block = innermostBlock(blocks, match.index);
    if (block === undefined || !holdsDataType(blocks, block)) continue;
    const codecId = memberOf(text, blocks, block, 'codecId');
    const dataType = codecId === undefined ? undefined : DATA_TYPES[codecId];
    if (dataType === undefined) continue;
    const quote = match[1] ?? "'";
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      text: `readonly dataType: ${quote}${dataType}${quote}`,
    });
  }

  for (const match of text.matchAll(/DefaultLiteralValue<\s*(['"])sqlite\/datetime@1\1\s*,\s*/g)) {
    const start = match.index + match[0].length;
    edits.push(...datetimeEdits(text, start, genericArgumentEnd(text, start)));
  }

  for (const match of text.matchAll(/readonly values: readonly \[/g)) {
    const valueSet = innermostBlock(blocks, match.index);
    const kind = valueSet?.parent;
    const namespace = kind?.parent?.parent;
    if (
      valueSet === undefined ||
      kind?.label !== 'valueSet' ||
      kind.parent?.label !== 'entries' ||
      namespace === undefined ||
      !datetimeEnums.has(enumKey(namespace.label, valueSet.label))
    )
      continue;
    const open = match.index + match[0].length - 1;
    edits.push(...datetimeEdits(text, open, bracketEnd(text, open)));
  }

  for (const match of text.matchAll(/readonly value: /g)) {
    const member = innermostBlock(blocks, match.index);
    const enumType = member?.parent;
    const namespace = enumType?.parent?.parent;
    if (
      member === undefined ||
      member.label !== '' ||
      enumType?.parent?.label !== 'enum' ||
      namespace === undefined ||
      !datetimeEnums.has(enumKey(namespace.label, enumType.label))
    )
      continue;
    const start = match.index + match[0].length;
    edits.push(...datetimeEdits(text, start, literalEnd(text, start)));
  }

  for (const match of text.matchAll(/(['"])([0-9a-f]{64})\1/g)) {
    const hash = match[2];
    const next = hash === undefined ? undefined : hashes.get(hash);
    if (next === undefined) continue;
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      text: `${match[1]}${next}${match[1]}`,
    });
  }

  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  return result;
}

interface ContractPlan {
  readonly path: string;
  readonly snapshot: boolean;
  readonly oldHash: string;
  readonly newHash: string;
  readonly content: string;
  readonly datetimeEnums: ReadonlySet<string>;
}

const JSON_FILES_THAT_MUST_PARSE = new Set(['contract.json', 'migration.json']);

function parseRoot(args: readonly string[]): { readonly root: string; readonly errors: string[] } {
  const errors = args.filter((arg) => arg.startsWith('-')).map((arg) => `${arg}: unknown option`);
  const positional = args.filter((arg) => !arg.startsWith('-'));
  if (positional.length > 1) errors.push(`expected one project root, got ${positional.length}`);
  const root = resolve(positional[0] ?? process.cwd());
  if (errors.length === 0 && !isDirectory(root)) errors.push(`${root}: not a directory`);
  if (errors.length > 0) errors.push('Usage: node data-type-values.ts [project-root]');
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
  const plans: ContractPlan[] = [];
  const notices: string[] = [];
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
      contract['target'] !== 'sqlite' ||
      !isRecord(contract['storage'])
    )
      continue;
    contractsFound++;
    const snapshot = isSnapshotContract(path);
    const stored = contract['storage']['storageHash'];
    const oldHash = snapshot ? basename(dirname(path)) : typeof stored === 'string' ? stored : '';
    const rewrite = rewriteContract(contract);
    if (!rewrite.changed) continue;
    if (computeStorageHash(contract) !== oldHash)
      notices.push(`${display(path)}: stored hash did not recompute; rehashed from content`);
    const newHash = computeStorageHash(rewrite.contract);
    const contractWithHash = withStorageHash(rewrite.contract, newHash);
    plans.push({
      path,
      snapshot,
      oldHash,
      newHash,
      content: snapshot ? snapshotForm(contractWithHash) : emittedForm(contractWithHash, text),
      datetimeEnums: rewrite.datetimeEnums,
    });
  }

  const hashes = new Map<string, string>();
  for (const plan of [...plans].sort((a, b) => Number(b.snapshot) - Number(a.snapshot)))
    if (plan.oldHash !== plan.newHash && !hashes.has(plan.oldHash))
      hashes.set(plan.oldHash, plan.newHash);

  const newDirectories = new Map<string, Map<string, string>>();
  const directorySources = new Map<string, string>();
  const sourceDirectories = new Set<string>();
  const removals = new Set<string>();
  const snapshotRewrites: [string, string][] = [];
  const referenceWrites = new Map<string, string>();
  const contractWrites = new Map<string, string>();
  for (const plan of plans) {
    const dtsPath = plan.snapshot
      ? join(dirname(plan.path), 'contract.d.ts')
      : `${plan.path.slice(0, -'.json'.length)}.d.ts`;
    const dtsHashes = plan.snapshot ? hashes : new Map([...hashes, [plan.oldHash, plan.newHash]]);
    const dts = existsSync(dtsPath)
      ? rewriteDts(readFileSync(dtsPath, 'utf8'), plan.datetimeEnums, dtsHashes)
      : undefined;
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
      stops.push(`${display(newDir)}: snapshot directory already exists with different content`);
      continue;
    }
    newDirectories.set(newDir, content);
    directorySources.set(newDir, oldDir);
  }
  for (const [dir, content] of newDirectories) {
    if (sourceDirectories.has(dir) || !existsSync(dir)) continue;
    if (sameFiles(readDirectory(dir), content)) newDirectories.delete(dir);
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
    const opsPath = join(dirname(path), 'ops.json');
    const ops = existsSync(opsPath) ? parseJson(readFileSync(opsPath, 'utf8')) : undefined;
    if (existsSync(opsPath) && ops === undefined) {
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
    const next = text.replace(
      /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/g,
      (hash: string) => hashes.get(hash) ?? hash,
    );
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
  const lines = [
    ...notices,
    ...summary(root, contractsFound, rewrittenFiles, removals.size, hashes),
  ];
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = main(parseRoot(process.argv.slice(2)));
