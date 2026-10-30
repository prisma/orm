#!/usr/bin/env node
/**
 * Moves the value objects of every SQL and MongoDB contract from the domain plane into storage. Contracts emitted before this release keep value objects at `domain.namespaces.<ns>.valueObjects` and type a field holding one as `{ kind: 'valueObject', name }`; this release keeps them at `storage.namespaces.<ns>.entries.valueObject` and types the field by the value object's storage coordinate. In each contract the script moves every value object into the storage namespace of the same id, points every field at it by coordinate, and points a member typed by an enum at the enum's storage value set. In a SQL contract it also writes the value set of each discriminator, keyed `<Base>.<field>` and holding the variants' values, and points the discriminator column at it, unless an enum already types that column. It makes the same changes in `contract.d.ts`.
 *
 * Storage now holds the value objects, so each rewritten contract has a new storage hash. The script renames each snapshot directory to its new hash and rewrites every migration, ref, `migration.ts` and `contract.d.ts` that names an old hash, and each migration's `migrationHash`. It does not add the checks PostgreSQL now derives for value object and discriminator columns: a snapshot records what its migrations created, and they created no such check. The next `prisma migration plan` adds them.
 *
 * Usage: node value-objects-in-storage.ts [project-root]
 *
 * The project root defaults to the working directory. The script reads and writes files only. It needs no database, network or configured stack, and a project whose contracts keep no value object in the domain plane is left unchanged. When it stops (a file it must read is not valid JSON, a contract whose stored hash does not match its content, a field naming a value object the contract does not declare, a value object whose namespace storage does not have, a member enum without a storage value set, a discriminator value set that already exists, a snapshot directory that already exists with different content, or a directory it cannot read) it changes no file, prints one line per case and exits 1. When it finishes it prints how many files and snapshot directories it changed and each storage hash it replaced.
 *
 * The storage hash and migration hash rules are copied from `@internal/contract`, `@internal/sql-contract`, `@internal/mongo-contract` and `@internal/migration-tools` because a project's strict `node_modules` does not expose them.
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

type Family = 'sql' | 'mongo';

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const HASH = /^[0-9a-f]{64}$/;
const TEMPORARY_SUFFIX = '.value-objects-in-storage-tmp';
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
const MONGO_PRESERVED_EMPTY: readonly (readonly PathSegment[])[] = [
  ['storage', 'namespaces', '*', 'entries', 'collection'],
  ['storage', 'namespaces', '*', 'entries', 'collection', '*'],
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

function isFamilyPreservedEmpty(family: Family, path: readonly string[]): boolean {
  if (family === 'mongo') {
    return (
      path.at(-1) === 'additionalProperties' ||
      (path.includes('jsonSchema') && (path.at(-2) === 'properties' || path.at(-1) === 'items')) ||
      MONGO_PRESERVED_EMPTY.some((pattern) => matchesPath(path, pattern))
    );
  }
  if (
    path.length >= COLUMN_DEFAULT_VALUE.length &&
    matchesPath(path.slice(0, COLUMN_DEFAULT_VALUE.length), COLUMN_DEFAULT_VALUE)
  )
    return true;
  return SQL_PRESERVED_EMPTY.some((pattern) => matchesPath(path, pattern));
}

function isPreservedEmpty(family: Family, path: readonly string[], key: string): boolean {
  if (key === 'nullable') return true;
  if (key === 'elementNullable' && path.at(-2) === 'many') return true;
  if (FRAMEWORK_PRESERVED_EMPTY.some((pattern) => matchesPath(path, pattern))) return true;
  return isFamilyPreservedEmpty(family, path);
}

function omitDefaults(family: Family, value: Json, path: readonly string[]): Json {
  if (Array.isArray(value)) return value.map((item) => omitDefaults(family, item, path));
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (key === '_generated') continue;
    if (key === 'generated' && child === false) continue;
    if ((key === 'onDelete' || key === 'onUpdate') && child === 'noAction') continue;
    if (isDefaultValue(child) && !isPreservedEmpty(family, childPath, key)) continue;
    result[key] = omitDefaults(family, child, childPath);
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

function computeStorageHash(family: Family, contract: JsonRecord): string {
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
  const withoutDefaults = omitDefaults(family, hashed, []);
  if (!isRecord(withoutDefaults)) return '';
  const withSortedStorage =
    family === 'sql'
      ? { ...withoutDefaults, storage: sortTableArrays(withoutDefaults['storage'] ?? {}) }
      : withoutDefaults;
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
  readonly unreadable: readonly { readonly dir: string; readonly code: string }[];
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
  const unreadable: { dir: string; code: string }[] = [];
  const visit = (dir: string): void => {
    const realDir = realpathSync(dir);
    if (visited.has(realDir)) return;
    visited.add(realDir);
    const listed = listDirectory(dir);
    if (!listed.ok) {
      unreadable.push({ dir, code: listed.code });
      return;
    }
    const entries = listed.entries.sort((a, b) => compareCodeUnits(a.name, b.name));
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
    unreadable,
  };
}

type DirectoryListing =
  | { readonly ok: true; readonly entries: Dirent[] }
  | { readonly ok: false; readonly code: string };

function listDirectory(dir: string): DirectoryListing {
  try {
    return { ok: true, entries: readdirSync(dir, { withFileTypes: true }) };
  } catch (error) {
    const code = error instanceof Error && 'code' in error ? String(error.code) : 'unknown error';
    return { ok: false, code };
  }
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

function replaceHashTokens(text: string, hashes: ReadonlyMap<string, string>): string {
  return text.replace(
    /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/g,
    (hash: string) => hashes.get(hash) ?? hash,
  );
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

function recordsOf(value: Json | undefined): [string, JsonRecord][] {
  return isRecord(value)
    ? Object.entries(value).filter((entry): entry is [string, JsonRecord] => isRecord(entry[1]))
    : [];
}

function coordinate(namespaceId: string, entityKind: string, entityName: string): JsonRecord {
  return { plane: 'storage', namespaceId, entityKind, entityName };
}

interface Rewrite {
  readonly contract: JsonRecord;
  readonly changed: boolean;
  /** The storage namespace each moved value object now lives in, by name. */
  readonly valueObjectNamespaces: ReadonlyMap<string, string>;
  readonly problems: readonly string[];
}

/** Whether the contract keeps value objects in the domain plane, or refers to one by name. */
function holdsOldValueObjects(contract: JsonRecord): boolean {
  const domain = isRecord(contract['domain']) ? contract['domain'] : {};
  for (const [, namespace] of recordsOf(domain['namespaces'])) {
    if (Object.hasOwn(namespace, 'valueObjects')) return true;
    for (const [, model] of recordsOf(namespace['models']))
      for (const [, field] of recordsOf(model['fields'])) {
        const type = field['type'];
        if (isRecord(type) && type['kind'] === 'valueObject' && typeof type['name'] === 'string')
          return true;
      }
  }
  return false;
}

/** A field that names a value object by `name`, pointed at it by its storage coordinate. */
function withValueObjectCoordinate(
  field: JsonRecord,
  namespaceOf: (name: string) => string | undefined,
  where: string,
  problems: string[],
): JsonRecord {
  const type = field['type'];
  if (!isRecord(type) || type['kind'] !== 'valueObject' || typeof type['name'] !== 'string')
    return field;
  const namespaceId = namespaceOf(type['name']);
  if (namespaceId === undefined) {
    problems.push(
      `${where} holds the value object ${type['name']}, which the contract does not declare`,
    );
    return field;
  }
  return {
    ...field,
    type: { kind: 'valueObject', ...coordinate(namespaceId, 'valueObject', type['name']) },
  };
}

function valueSetsOf(storageNamespace: JsonRecord): JsonRecord {
  const entries = isRecord(storageNamespace['entries']) ? storageNamespace['entries'] : {};
  return isRecord(entries['valueSet']) ? entries['valueSet'] : {};
}

/** The old MongoDB schema let a member leave `nullable` out, meaning `false`, and say `dict: false`; storage requires `nullable` and keeps `dict` only when it is `true`. */
function withStorageModifiers(member: JsonRecord): JsonRecord {
  const { dict, ...rest } = member;
  return {
    ...rest,
    nullable: member['nullable'] === undefined ? false : member['nullable'],
    ...(dict === undefined || dict === false ? {} : { dict }),
  };
}

/** A value object member, with an enum reference pointed at the enum's storage value set. */
function rewrittenMember(
  stored: JsonRecord,
  storageNamespaces: JsonRecord,
  where: string,
  problems: string[],
): JsonRecord {
  const member = withStorageModifiers(stored);
  const valueSet = member['valueSet'];
  if (!isRecord(valueSet) || valueSet['plane'] === 'storage') return member;
  const namespaceId = valueSet['namespaceId'];
  const name = valueSet['entityName'];
  const storageNamespace =
    typeof namespaceId === 'string' ? storageNamespaces[namespaceId] : undefined;
  if (
    typeof namespaceId !== 'string' ||
    typeof name !== 'string' ||
    !isRecord(storageNamespace) ||
    !Object.hasOwn(valueSetsOf(storageNamespace), name)
  ) {
    problems.push(
      `${where} is typed by the enum ${String(name)}, which has no value set in storage namespace ${String(namespaceId)}`,
    );
    return member;
  }
  return { ...member, valueSet: { ...valueSet, ...coordinate(namespaceId, 'valueSet', name) } };
}

/** Writes each discriminator's value set, `<Base>.<field>`, in its base table's namespace, and points the column at it, unless an enum already types the column. */
function writeDiscriminatorValueSets(
  domainNamespaces: JsonRecord,
  storageNamespaces: JsonRecord,
  problems: string[],
): boolean {
  let changed = false;
  for (const [modelNamespaceId, namespace] of recordsOf(domainNamespaces)) {
    for (const [modelName, model] of recordsOf(namespace['models'])) {
      const discriminator = model['discriminator'];
      const variants = model['variants'];
      const storage = model['storage'];
      if (!isRecord(discriminator) || !isRecord(variants) || !isRecord(storage)) continue;
      const field = discriminator['field'];
      const fields = isRecord(storage['fields']) ? storage['fields'] : {};
      const fieldStorage = typeof field === 'string' ? fields[field] : undefined;
      const columnName = isRecord(fieldStorage) ? fieldStorage['column'] : undefined;
      const tableName = storage['table'];
      const namespaceId =
        typeof storage['namespaceId'] === 'string' ? storage['namespaceId'] : modelNamespaceId;
      const storageNamespace = storageNamespaces[namespaceId];
      const entries = isRecord(storageNamespace) ? storageNamespace['entries'] : undefined;
      const tables = isRecord(entries) ? entries['table'] : undefined;
      const table =
        isRecord(tables) && typeof tableName === 'string' ? tables[tableName] : undefined;
      const columns = isRecord(table) ? table['columns'] : undefined;
      const column =
        isRecord(columns) && typeof columnName === 'string' ? columns[columnName] : undefined;
      if (
        typeof field !== 'string' ||
        typeof columnName !== 'string' ||
        !isRecord(entries) ||
        !isRecord(columns) ||
        !isRecord(column) ||
        column['valueSet'] !== undefined
      )
        continue;
      const name = `${modelName}.${field}`;
      const valueSets = isRecord(entries['valueSet']) ? entries['valueSet'] : {};
      if (Object.hasOwn(valueSets, name)) {
        problems.push(
          `the discriminator ${name} writes the value set ${name} in storage namespace ${namespaceId}, which already holds a value set of that name; rename the enum`,
        );
        continue;
      }
      entries['valueSet'] = {
        ...valueSets,
        [name]: { kind: 'valueSet', values: Object.keys(variants).sort(compareCodeUnits) },
      };
      columns[columnName] = { ...column, valueSet: coordinate(namespaceId, 'valueSet', name) };
      changed = true;
    }
  }
  return changed;
}

/** The contract with its value objects moved into storage, and on SQL each discriminator's value set written. */
function rewriteContract(contract: JsonRecord, family: Family): Rewrite {
  const unchanged: Rewrite = {
    contract,
    changed: false,
    valueObjectNamespaces: new Map(),
    problems: [],
  };
  if (!holdsOldValueObjects(contract)) return unchanged;
  const copy = parseJson(JSON.stringify(contract));
  if (!isRecord(copy) || !isRecord(copy['domain']) || !isRecord(copy['storage'])) return unchanged;
  const domainNamespaces = isRecord(copy['domain']['namespaces'])
    ? copy['domain']['namespaces']
    : {};
  const storageNamespaces = isRecord(copy['storage']['namespaces'])
    ? copy['storage']['namespaces']
    : {};
  const problems: string[] = [];
  const valueObjectNamespaces = new Map<string, string>();
  const declaredIn = new Map<string, Set<string>>();
  for (const [namespaceId, namespace] of recordsOf(domainNamespaces))
    for (const [name] of recordsOf(namespace['valueObjects']))
      declaredIn.set(name, new Set([...(declaredIn.get(name) ?? []), namespaceId]));
  const namespaceFor =
    (ownNamespaceId: string) =>
    (name: string): string | undefined => {
      const namespaces = declaredIn.get(name);
      if (namespaces === undefined) return undefined;
      if (namespaces.has(ownNamespaceId)) return ownNamespaceId;
      return namespaces.size === 1 ? [...namespaces][0] : undefined;
    };

  for (const [namespaceId, namespace] of recordsOf(domainNamespaces)) {
    const valueObjects = namespace['valueObjects'];
    delete namespace['valueObjects'];
    for (const [modelName, model] of recordsOf(namespace['models'])) {
      const fields = model['fields'];
      for (const [fieldName, field] of recordsOf(fields))
        if (isRecord(fields))
          fields[fieldName] = withValueObjectCoordinate(
            field,
            namespaceFor(namespaceId),
            `field ${modelName}.${fieldName}`,
            problems,
          );
    }
    if (!isRecord(valueObjects)) continue;
    const storageNamespace = storageNamespaces[namespaceId];
    if (!isRecord(storageNamespace)) {
      problems.push(
        `the value objects of domain namespace ${namespaceId} have no storage namespace ${namespaceId} to move to`,
      );
      continue;
    }
    const moved: JsonRecord = {};
    for (const [name, valueObject] of recordsOf(valueObjects)) {
      valueObjectNamespaces.set(name, namespaceId);
      const members: JsonRecord = {};
      for (const [memberName, member] of recordsOf(valueObject['fields'])) {
        const where = `value object member ${name}.${memberName}`;
        members[memberName] = rewrittenMember(
          withValueObjectCoordinate(member, namespaceFor(namespaceId), where, problems),
          storageNamespaces,
          where,
          problems,
        );
      }
      moved[name] = { ...valueObject, fields: members };
    }
    const entries = isRecord(storageNamespace['entries']) ? storageNamespace['entries'] : {};
    storageNamespace['entries'] = { ...entries, valueObject: moved };
  }
  if (family === 'sql') writeDiscriminatorValueSets(domainNamespaces, storageNamespaces, problems);
  if (Object.hasOwn(copy, 'valueObjects')) delete copy['valueObjects'];
  return { contract: copy, changed: true, valueObjectNamespaces, problems };
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

function childBlocks(blocks: readonly Block[], parent: Block): Block[] {
  return blocks.filter((block) => block.parent === parent);
}

function isUnder(block: Block, labels: readonly string[]): boolean {
  let current = block.parent;
  for (const label of labels) {
    if (current?.label !== label) return false;
    current = current.parent;
  }
  return true;
}

/** A block re-indented from `from` to `to`, its first line left as it starts. */
function reindent(literal: string, from: string, to: string): string {
  return literal
    .split('\n')
    .map((line, index) =>
      index === 0 || !line.startsWith(from) ? line : `${to}${line.slice(from.length)}`,
    )
    .join('\n');
}

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

const STORAGE_NAMESPACES = "ContractBase['storage']['namespaces']";

function dtsPathOf(contractPath: string, snapshot: boolean): string {
  return snapshot
    ? join(dirname(contractPath), 'contract.d.ts')
    : `${contractPath.slice(0, -'.json'.length)}.d.ts`;
}
const DTS_LINE_WIDTH = 100;

/**
 * The same move in `contract.d.ts`: each `valueObjects` type of a domain namespace goes into its storage namespace's `entries` as `valueObject`, a member's enum reference names the storage value set, a field's value object type names its coordinate, the top-level `valueObjects` type goes, and the value object and field type aliases read storage. The discriminator value sets are not typed: a re-emit types them.
 */
function rewriteDts(
  text: string,
  valueObjectNamespaces: ReadonlyMap<string, string>,
  hashes: ReadonlyMap<string, string>,
): string {
  const lineEnding = lineEndingOf(text);
  const blocks = scanBlocks(text);
  const edits: Edit[] = [];
  const moved = new Map<string, string>();
  for (const block of blocks) {
    if (block.label !== 'valueObjects') continue;
    const namespace = block.parent;
    if (namespace !== undefined && isUnder(namespace, ['namespaces', 'domain'])) {
      const literal = text
        .slice(block.start, block.end + 1)
        .replace(/readonly plane: (['"])domain\1/g, "readonly plane: 'storage'")
        .replace(/readonly entityKind: (['"])enum\1/g, "readonly entityKind: 'valueSet'");
      moved.set(namespace.label, reindent(literal, indentOf(text, block.start), ''));
      edits.push({ start: lineStart(text, block.start), end: memberEnd(text, block), text: '' });
    } else if (
      namespace !== undefined &&
      childBlocks(blocks, namespace).some((sibling) => sibling.label === 'domain')
    ) {
      edits.push({ start: lineStart(text, block.start), end: memberEnd(text, block), text: '' });
    }
  }
  for (const block of blocks) {
    if (block.label !== 'entries' || block.parent === undefined) continue;
    if (!isUnder(block.parent, ['namespaces']) || isUnder(block.parent, ['namespaces', 'domain']))
      continue;
    const literal = moved.get(block.parent.label);
    if (literal === undefined) continue;
    const indent = `${indentOf(text, block.start)}  `;
    const closing = lineStart(text, block.end);
    edits.push({
      start: closing,
      end: closing,
      text: `${indent}readonly valueObject: ${reindent(literal, '', indent)};${lineEnding}`,
    });
  }
  let result = text;
  for (const edit of edits.sort((a, b) => b.start - a.start))
    result = `${result.slice(0, edit.start)}${edit.text}${result.slice(edit.end)}`;
  result = result
    .replace(
      /\{\s*readonly kind: (['"])valueObject\1;\s*readonly name: (['"])([^'"]*)\2;?\s*\}/g,
      (
        match: string,
        _quote: string,
        _nameQuote: string,
        name: string,
        offset: number,
        whole: string,
      ) => {
        const namespaceId = valueObjectNamespaces.get(name);
        return namespaceId === undefined
          ? match
          : coordinateTypeLiteral(namespaceId, name, whole, offset, lineEnding);
      },
    )
    .replace(
      /ValueObjectTypesFromDomain<(\s*)ContractBase\['domain'\]\['namespaces'\]/g,
      `ValueObjectTypesFromStorage<$1${STORAGE_NAMESPACES}`,
    )
    .replace(/\bValueObjectTypesFromDomain\b/g, 'ValueObjectTypesFromStorage');
  return replaceHashTokens(withStorageNamespacesArgument(result), hashes);
}

/** `FieldTypesFromDomain` with the storage namespaces as its sixth argument, which it now requires of every contract. */
function withStorageNamespacesArgument(text: string): string {
  const lineEnding = lineEndingOf(text);
  return text.replace(
    /(FieldTypesFromDomain<[^<>]*?(['"])(?:output|input)\2)(\s*)>/g,
    (_match: string, head: string, _quote: string, space: string) =>
      space.includes('\n')
        ? `${head},${lineEnding}  ${STORAGE_NAMESPACES}${lineEnding}>`
        : `${head}, ${STORAGE_NAMESPACES}>`,
  );
}

/** A value object field's coordinate type, on one line when it fits the emitter's line width, else one member per line. */
function coordinateTypeLiteral(
  namespaceId: string,
  name: string,
  text: string,
  offset: number,
  lineEnding: string,
): string {
  const members = [
    "readonly kind: 'valueObject'",
    "readonly plane: 'storage'",
    `readonly namespaceId: '${namespaceId}'`,
    "readonly entityKind: 'valueObject'",
    `readonly entityName: '${name}'`,
  ];
  const single = `{ ${members.join('; ')} }`;
  if (offset - lineStart(text, offset) + single.length + 1 <= DTS_LINE_WIDTH) return single;
  const indent = indentOf(text, offset);
  const lines = members.map((member) => `${indent}  ${member};`);
  return `{${lineEnding}${lines.join(lineEnding)}${lineEnding}${indent}}`;
}

interface ContractPlan {
  readonly path: string;
  readonly snapshot: boolean;
  readonly oldHash: string;
  readonly newHash: string;
  readonly content: string;
  readonly valueObjectNamespaces: ReadonlyMap<string, string>;
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

function familyOf(contract: JsonRecord): Family | undefined {
  const family = contract['targetFamily'];
  return family === 'sql' || family === 'mongo' ? family : undefined;
}

function summary(
  root: string,
  contractsFound: number,
  files: number,
  directories: number,
  hashes: ReadonlyMap<string, string>,
): readonly string[] {
  if (contractsFound === 0)
    return [`No SQL or MongoDB contract was found under ${root}; nothing changed.`];
  if (files === 0 && directories === 0)
    return ['No contract keeps value objects in the domain plane; nothing changed.'];
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
  if (files.unreadable.length > 0) {
    process.stderr.write(
      `${files.unreadable
        .map(
          ({ dir, code }) =>
            `${display(dir)}: cannot read the directory (${code}); give the script read access to it, or move it out of the project, and run the script again`,
        )
        .join('\n')}\n`,
    );
    return 1;
  }
  const plans: ContractPlan[] = [];
  const argumentWrites = new Map<string, string>();
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
    if (!isRecord(contract) || typeof contract['target'] !== 'string') continue;
    const family = familyOf(contract);
    if (family === undefined || !isRecord(contract['storage'])) continue;
    contractsFound++;
    const rewrite = rewriteContract(contract, family);
    const snapshot = isSnapshotContract(path);
    if (!rewrite.changed) {
      const dtsPath = dtsPathOf(path, snapshot);
      if (existsSync(dtsPath)) {
        const dts = readFileSync(dtsPath, 'utf8');
        const next = withStorageNamespacesArgument(dts);
        if (next !== dts) argumentWrites.set(dtsPath, next);
      }
      continue;
    }
    const stored = contract['storage']['storageHash'];
    const oldHash = snapshot ? basename(dirname(path)) : typeof stored === 'string' ? stored : '';
    const computed = computeStorageHash(family, contract);
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
    const newHash = computeStorageHash(family, rewrite.contract);
    plans.push({
      path,
      snapshot,
      oldHash,
      newHash,
      content: writtenForm(withStorageHash(rewrite.contract, newHash), contract, text),
      valueObjectNamespaces: rewrite.valueObjectNamespaces,
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
    const dtsPath = dtsPathOf(plan.path, plan.snapshot);
    const dtsHashes = new Map([...hashes, [plan.oldHash, plan.newHash]]);
    const dts = existsSync(dtsPath)
      ? rewriteDts(readFileSync(dtsPath, 'utf8'), plan.valueObjectNamespaces, dtsHashes)
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
    for (const [path, text] of argumentWrites) writeFile(path, text);
    for (const dir of removals) removeDirectory(dir);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(
      `${message}; the upgrade stopped partway, run the script again to finish it\n`,
    );
    return 1;
  }
  const rewrittenFiles =
    snapshotRewrites.length + referenceWrites.size + contractWrites.size + argumentWrites.size;
  const lines = summary(root, contractsFound, rewrittenFiles, removals.size, hashes);
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

function parseRoot(args: readonly string[]): { readonly root: string; readonly errors: string[] } {
  const errors = args.filter((arg) => arg.startsWith('-')).map((arg) => `${arg}: unknown option`);
  const positional = args.filter((arg) => !arg.startsWith('-'));
  if (positional.length > 1) errors.push(`expected one project root, got ${positional.length}`);
  const root = resolve(positional[0] ?? process.cwd());
  if (errors.length === 0 && !isDirectory(root)) errors.push(`${root}: not a directory`);
  if (errors.length > 0) errors.push('Usage: node value-objects-in-storage.ts [project-root]');
  return { root, errors };
}

process.exitCode = main(parseRoot(process.argv.slice(2)));
