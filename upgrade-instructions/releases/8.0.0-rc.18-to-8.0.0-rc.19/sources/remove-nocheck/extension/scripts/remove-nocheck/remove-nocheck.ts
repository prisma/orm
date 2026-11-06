#!/usr/bin/env node
/**
 * Removes the `noCheck` key from every column of every SQL contract in a project. Where the key waived the element check of a list, the column and the field that maps it become lists whose elements may be null, in `contract.json` and `contract.d.ts`, because that is what the database enforces. The checks each contract declares are left as they are. The script then renames the snapshot directories and rewrites every migration, ref, `migration.ts` and `contract.d.ts` that names an old storage hash.
 *
 * Usage: node remove-nocheck.ts [project-root]
 *
 * The project root defaults to the working directory. The script reads and writes files only. It needs no database, network or configured stack, and a project with no `noCheck` key is left unchanged. When it stops (a file it must read is not valid JSON, a contract whose stored hash does not match its content, or a snapshot directory that already exists with different content) it changes no file, prints one line per case and exits 1. When it finishes it prints how many files and snapshot directories it changed and each storage hash it replaced.
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

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);
const HASH = /^[0-9a-f]{64}$/;
const TEMPORARY_SUFFIX = '.remove-nocheck-tmp';

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
        if (!SKIPPED_DIRECTORIES.has(entry.name)) visit(path);
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

const REMOVED_KEY = 'noCheck';
const ELEMENT_KIND = 'elementNotNull';

function listKey(namespace: string, owner: string, member: string): string {
  return `${namespace}\u0000${owner}\u0000${member}`;
}

interface Rewrite {
  readonly contract: JsonRecord;
  readonly changed: boolean;
  readonly columns: ReadonlySet<string>;
  readonly fields: ReadonlySet<string>;
}

function allowNullElements(holder: JsonRecord): void {
  const many = holder['many'];
  if (isRecord(many)) holder['many'] = { ...many, elementNullable: true };
}

/** Mutates `copy`: the domain fields that map a column whose element check was waived. */
function fieldsMappingColumns(copy: JsonRecord, columns: ReadonlySet<string>): Set<string> {
  const fields = new Set<string>();
  const domain = copy['domain'];
  const namespaces = isRecord(domain) ? domain['namespaces'] : undefined;
  for (const [namespaceId, namespace] of isRecord(namespaces) ? Object.entries(namespaces) : []) {
    const models = isRecord(namespace) ? namespace['models'] : undefined;
    for (const [modelName, model] of isRecord(models) ? Object.entries(models) : []) {
      if (!isRecord(model)) continue;
      const storage = model['storage'];
      const modelFields = model['fields'];
      if (!isRecord(storage) || !isRecord(modelFields)) continue;
      const table = storage['table'];
      const tableNamespace =
        typeof storage['namespaceId'] === 'string' ? storage['namespaceId'] : namespaceId;
      const mapped = storage['fields'];
      for (const [fieldName, mapping] of isRecord(mapped) ? Object.entries(mapped) : []) {
        const column = isRecord(mapping) ? mapping['column'] : undefined;
        const field = modelFields[fieldName];
        if (typeof table !== 'string' || typeof column !== 'string' || !isRecord(field)) continue;
        if (!columns.has(listKey(tableNamespace, table, column))) continue;
        allowNullElements(field);
        fields.add(listKey(namespaceId, modelName, fieldName));
      }
    }
  }
  return fields;
}

/** The contract with the key removed from each column, and the lists whose element check it waived made element-nullable. */
function rewriteContract(contract: JsonRecord): Rewrite {
  const copy = parseJson(JSON.stringify(contract));
  if (!isRecord(copy)) return { contract, changed: false, columns: new Set(), fields: new Set() };
  let changed = false;
  const columns = new Set<string>();
  const storage = copy['storage'];
  const namespaces = isRecord(storage) ? storage['namespaces'] : undefined;
  for (const [namespaceId, namespace] of isRecord(namespaces) ? Object.entries(namespaces) : []) {
    const entries = isRecord(namespace) ? namespace['entries'] : undefined;
    const tables = isRecord(entries) ? entries['table'] : undefined;
    for (const [tableName, table] of isRecord(tables) ? Object.entries(tables) : []) {
      const tableColumns = isRecord(table) ? table['columns'] : undefined;
      for (const [columnName, column] of isRecord(tableColumns)
        ? Object.entries(tableColumns)
        : []) {
        if (!isRecord(column) || !Object.hasOwn(column, REMOVED_KEY)) continue;
        const kinds = column[REMOVED_KEY];
        delete column[REMOVED_KEY];
        changed = true;
        if (Array.isArray(kinds) && kinds.includes(ELEMENT_KIND) && isRecord(column['many'])) {
          allowNullElements(column);
          columns.add(listKey(namespaceId, tableName, columnName));
        }
      }
    }
  }
  return { contract: copy, changed, columns, fields: fieldsMappingColumns(copy, columns) };
}

function withStorageHash(contract: JsonRecord, hash: string): JsonRecord {
  const storage = contract['storage'];
  if (!isRecord(storage) || typeof storage['storageHash'] !== 'string') return contract;
  return { ...contract, storage: { ...storage, storageHash: hash } };
}

/** The contract written the way the file held it: a snapshot's canonical line, or indented JSON. */
function writtenForm(contract: JsonRecord, original: JsonRecord, text: string): string {
  const newline = text.endsWith('\n') ? '\n' : '';
  if (text === `${canonicalizeJson(original)}${newline}`)
    return `${canonicalizeJson(contract)}${newline}`;
  return `${JSON.stringify(contract, null, 2)}${newline}`;
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
  for (const block of blocks)
    if (
      block.start < position &&
      position < block.end &&
      (found === undefined || block.start > found.start)
    )
      found = block;
  return found;
}

/** The key of a storage column block (`namespaces.<ns>.entries.table.<table>.columns.<column>`). */
function columnBlockKey(block: Block): string | undefined {
  const table = block.parent?.parent;
  const namespace = table?.parent?.parent?.parent;
  if (block.parent?.label !== 'columns' || table?.parent?.label !== 'table') return undefined;
  if (table.parent.parent?.label !== 'entries' || namespace === undefined) return undefined;
  return listKey(namespace.label, table.label, block.label);
}

/** The key of a domain field block (`namespaces.<ns>.models.<model>.fields.<field>`). */
function fieldBlockKey(block: Block): string | undefined {
  const model = block.parent?.parent;
  const namespace = model?.parent?.parent;
  if (block.parent?.label !== 'fields' || model?.parent?.label !== 'models') return undefined;
  if (namespace === undefined) return undefined;
  return listKey(namespace.label, model.label, block.label);
}

function rewriteDts(
  text: string,
  columns: ReadonlySet<string>,
  fields: ReadonlySet<string>,
  hashes: ReadonlyMap<string, string>,
): string {
  const blocks = scanBlocks(text);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const match of text.matchAll(/readonly elementNullable:\s*false/g)) {
    const many = innermostBlock(blocks, match.index);
    const holder = many?.label === 'many' ? many.parent : undefined;
    if (holder === undefined) continue;
    const column = columnBlockKey(holder);
    const field = fieldBlockKey(holder);
    if (
      !(column !== undefined && columns.has(column)) &&
      !(field !== undefined && fields.has(field))
    )
      continue;
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      text: 'readonly elementNullable: true',
    });
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
  readonly columns: ReadonlySet<string>;
  readonly fields: ReadonlySet<string>;
}

function summary(
  root: string,
  contractsFound: number,
  files: number,
  directories: number,
  hashes: ReadonlyMap<string, string>,
): readonly string[] {
  if (contractsFound === 0) return [`No SQL contract was found under ${root}; nothing changed.`];
  if (files === 0 && directories === 0)
    return ['No contract stores a noCheck key; nothing changed.'];
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

const JSON_FILES_THAT_MUST_PARSE = new Set(['contract.json', 'migration.json']);

function main(root: string): number {
  const display = (path: string): string => relative(root, path).split(sep).join('/');
  const files = listFiles(root);
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
    const rewrite = rewriteContract(contract);
    if (!rewrite.changed) continue;
    const snapshot = isSnapshotContract(path);
    const stored = contract['storage']['storageHash'];
    const oldHash = snapshot ? basename(dirname(path)) : typeof stored === 'string' ? stored : '';
    const computed = computeStorageHash(contract);
    if (computed !== oldHash || (typeof stored === 'string' && stored !== oldHash)) {
      stops.push(
        `${display(path)}: the stored storage hash ${oldHash} does not match the contract's content, which hashes to ${computed}; restore the file from version control, or re-emit it, and run the script again`,
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
      columns: rewrite.columns,
      fields: rewrite.fields,
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
    const dtsHashes = new Map([...hashes, [plan.oldHash, plan.newHash]]);
    const dts = existsSync(dtsPath)
      ? rewriteDts(readFileSync(dtsPath, 'utf8'), plan.columns, plan.fields, dtsHashes)
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
  const lines = summary(root, contractsFound, rewrittenFiles, removals.size, hashes);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = main(resolve(process.argv[2] ?? '.'));
