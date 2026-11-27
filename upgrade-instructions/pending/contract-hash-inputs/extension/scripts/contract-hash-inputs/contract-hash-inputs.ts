#!/usr/bin/env node
/**
 * Gives every stored contract hash in a project the value this release computes. A contract's storage, profile and execution hashes used to cover a stand-in contract: the section, plus `schemaVersion: "1"` and blank `profileHash`, `roots`, `domain`, `extensions`, `meta` and `capabilities`. They now cover only the target, the family and their own section. The canonicalization also used to leave out every `false`, empty list and empty object outside a list of kept paths; it now leaves out no value except the defaults each family names in its storage, so a value such as a restrictive policy's `permissive: false`, which the file kept and the hash left out, is now in the hash. Each family also orders the storage lists whose order has no meaning, by name and then by content: a SQL table's checks, foreign keys, indexes and uniques, and a MongoDB collection's indexes. So two contracts that list them in another order now have one storage hash.
 *
 * Usage: node contract-hash-inputs.ts [project-root]
 *
 * The project root defaults to the working directory. The script reads and writes files only; it needs no database. It walks the root, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot, and finds stored files the way the `stored-files-format-version` script does: a contract by its content (`targetFamily` and `storage`) in any `*.json` file, a `migration.json` by the `ops.json` next to it, and a ref file by where Prisma writes refs or by its content.
 *
 * First it checks every contract: each stored `storageHash`, `profileHash` and `executionHash`, and each snapshot directory's name, must be the hash the old rules or the new rules give the contract's content. Two exceptions: a snapshot's profile and execution hash may come from an earlier release's rules, and a MongoDB snapshot may keep the storage hash it had before an earlier upgrade step rewrote its content; both get the hashes their content gives. Then it checks each `migration.json` against its `migrationHash`, and that each `from`, `to` and ref `hash` names a contract of the project. If any check fails, it changes no file, prints one line per problem and exits 1. A hash that does not match the content means the file was edited by hand or comes from another release; fix that first.
 *
 * It reads a stored file whether or not it has a `formatVersion`, and leaves its format version as it is: a file a release candidate wrote keeps `"schemaVersion": "1"`, or no version field, and this release reads it as format version 0.
 *
 * A contract that is not a snapshot and whose storage hash no migration, ref or snapshot names, such as a hand-made test fixture, does not stop the upgrade when its hashes are wrong: it is reported, left unchanged, and makes the script exit 1.
 *
 * Otherwise it rewrites: the three hashes in every contract; the same hashes in the `contract.d.ts` beside it; each snapshot directory's name; `from`, `to` and `migrationHash` in every `migration.json`, and the storage hashes in the `ops.json` beside it; `hash` in every ref file; and every old storage hash in every `migration.ts` (snapshot import paths and hash literals). It edits each file's text, so every other byte stays, including a leading byte order mark, and replaces each file in one rename, so a run that stops partway can be run again to finish. It prints what it changed and each hash it replaced. A `contract.d.ts` whose hashes it cannot match with its contract, or a migration or ref naming a hash it cannot tell the new value of, is reported, left unchanged, and makes it exit 1. A second run changes nothing.
 *
 * The hash rules, old and new, the families' normal forms of storage and the migration hash rule are copied from Prisma's packages, because a project's strict `node_modules` does not expose them.
 */
import { createHash } from 'node:crypto';
import {
  chmodSync,
  type Dirent,
  existsSync,
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
type HashKind = 'storage' | 'profile' | 'execution';

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const SPACE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const HASH = /^[0-9a-f]{64}$/;
const REF_HASH = /^(empty|[0-9a-f]{64})$/;
const BYTE_ORDER_MARK = '﻿';
const UNKNOWN_HASH =
  'is a storage hash no contract or snapshot in the project has, so the script cannot tell its new value.';
const TEMPORARY_SUFFIX = '.contract-hash-inputs-tmp';
const REMOVED_SUFFIX = '.contract-hash-inputs-removed';

function isRecord(value: unknown): value is JsonRecord {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return false;
  const prototype: unknown = Object.getPrototypeOf(value);
  return prototype === Object.prototype || prototype === null;
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function sha256(text: string): string {
  return createHash('sha256').update(text).digest('hex');
}

/** Stores `value` as an own key of `target`, so a key named `__proto__` is a key rather than the prototype. */
function defineOwn(target: JsonRecord, key: string, value: Json): void {
  Object.defineProperty(target, key, {
    value,
    enumerable: true,
    writable: true,
    configurable: true,
  });
}

function sortKeys(value: Json): Json {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isRecord(value)) return value;
  const sorted: JsonRecord = {};
  for (const key of Object.keys(value).sort(compareCodeUnits)) {
    const child = value[key];
    if (child !== undefined) defineOwn(sorted, key, sortKeys(child));
  }
  return sorted;
}

function canonicalizeJson(value: Json): string {
  return JSON.stringify(sortKeys(value));
}

// ---------------------------------------------------------------------------
// Canonicalization, shared by the old and the new hash rules.

type PathSegment = string | readonly string[];
type PathPattern = readonly PathSegment[];

function matchesPath(path: readonly string[], pattern: PathPattern): boolean {
  if (path.length !== pattern.length) return false;
  return pattern.every((segment, index) => {
    const value = path[index];
    if (value === undefined) return false;
    if (segment === '*') return true;
    return typeof segment === 'string' ? value === segment : segment.includes(value);
  });
}

const FRAMEWORK_REQUIRED: readonly PathPattern[] = [
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

const SQL_PRESERVED_EMPTY: readonly PathPattern[] = [
  ['storage', 'namespaces', '*', 'entries', 'table'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', ['uniques', 'indexes', 'foreignKeys']],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'indexes', 'unique'],
  ['storage', 'namespaces', '*', 'entries', 'table', '*', 'columns', '*', 'default', 'value'],
  ['domain', 'namespaces', '*', 'models', '*', 'fields'],
  ['domain', 'namespaces', '*', 'models', '*', 'storage', 'fields'],
];
const SQL_COLUMN_DEFAULT_VALUE: PathPattern = [
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
const MONGO_PRESERVED_EMPTY: readonly PathPattern[] = [
  ['storage', 'namespaces', '*', 'entries', 'collection'],
  ['storage', 'namespaces', '*', 'entries', 'collection', '*'],
  ['domain', 'namespaces', '*', 'models', '*', 'fields'],
  ['domain', 'namespaces', '*', 'models', '*', 'storage', 'fields'],
];

type PreserveEmpty = (path: readonly string[]) => boolean;

const PRESERVE_EMPTY: Record<Family, PreserveEmpty> = {
  sql: (path) =>
    (path.length >= SQL_COLUMN_DEFAULT_VALUE.length &&
      matchesPath(path.slice(0, SQL_COLUMN_DEFAULT_VALUE.length), SQL_COLUMN_DEFAULT_VALUE)) ||
    SQL_PRESERVED_EMPTY.some((pattern) => matchesPath(path, pattern)),
  mongo: (path) =>
    path.at(-1) === 'additionalProperties' ||
    (path.includes('jsonSchema') && (path.at(-2) === 'properties' || path.at(-1) === 'items')) ||
    MONGO_PRESERVED_EMPTY.some((pattern) => matchesPath(path, pattern)),
};

function isDefaultValue(value: Json): boolean {
  if (value === false) return true;
  if (Array.isArray(value)) return value.length === 0;
  return isRecord(value) && Object.keys(value).length === 0;
}

function omitDefaults(
  value: Json,
  path: readonly string[],
  preserveEmpty: PreserveEmpty | undefined,
): Json {
  if (Array.isArray(value)) return value.map((item) => omitDefaults(item, path, preserveEmpty));
  if (!isRecord(value)) return value;
  const result: JsonRecord = {};
  for (const [key, child] of Object.entries(value)) {
    const childPath = [...path, key];
    if (key === '_generated') continue;
    if (key === 'generated' && child === false) continue;
    if ((key === 'onDelete' || key === 'onUpdate') && child === 'noAction') continue;
    if (
      isDefaultValue(child) &&
      key !== 'nullable' &&
      !(key === 'elementNullable' && path.at(-1) === 'many') &&
      !FRAMEWORK_REQUIRED.some((pattern) => matchesPath(childPath, pattern)) &&
      !(preserveEmpty?.(childPath) ?? false)
    )
      continue;
    defineOwn(result, key, omitDefaults(child, childPath, preserveEmpty));
  }
  return result;
}

function compareByName(a: Json, b: Json): number {
  const nameA = isRecord(a) && typeof a['name'] === 'string' ? a['name'] : '';
  const nameB = isRecord(b) && typeof b['name'] === 'string' ? b['name'] : '';
  return compareCodeUnits(nameA, nameB);
}

/** The SQL family's storage sort: each table's `checks`, `indexes` and `uniques` by name. */
function sortSqlStorage(storage: Json): Json {
  if (!isRecord(storage) || !isRecord(storage['namespaces'])) return storage;
  const namespaces: JsonRecord = { ...storage['namespaces'] };
  for (const [namespaceId, namespace] of Object.entries(namespaces)) {
    if (!isRecord(namespace) || !isRecord(namespace['entries'])) continue;
    const entries = namespace['entries'];
    if (!isRecord(entries['table'])) continue;
    const tables: JsonRecord = { ...entries['table'] };
    for (const [tableName, table] of Object.entries(tables)) {
      if (!isRecord(table)) continue;
      const sorted: JsonRecord = { ...table };
      for (const key of ['checks', 'indexes', 'uniques']) {
        const list = table[key];
        if (Array.isArray(list)) sorted[key] = [...list].sort(compareByName);
      }
      defineOwn(tables, tableName, sorted);
    }
    defineOwn(namespaces, namespaceId, {
      ...namespace,
      entries: { ...entries, table: tables },
    });
  }
  return { ...storage, namespaces };
}

interface Hooks {
  readonly preserveEmpty?: PreserveEmpty;
  readonly sortStorage?: (storage: Json) => Json;
}

function storageHooks(family: Family): Hooks {
  return family === 'sql'
    ? { preserveEmpty: PRESERVE_EMPTY.sql, sortStorage: sortSqlStorage }
    : { preserveEmpty: PRESERVE_EMPTY.mongo };
}

function canonicalSections(sections: JsonRecord, hooks: Hooks): JsonRecord {
  const withoutDefaults = omitDefaults(sections, [], hooks.preserveEmpty);
  if (!isRecord(withoutDefaults)) return {};
  const withSortedStorage =
    hooks.sortStorage !== undefined && withoutDefaults['storage'] !== undefined
      ? { ...withoutDefaults, storage: hooks.sortStorage(withoutDefaults['storage']) }
      : withoutDefaults;
  const sorted = sortKeys(withSortedStorage);
  return isRecord(sorted) ? sorted : {};
}

// ---------------------------------------------------------------------------
// The hash inputs.

interface ContractSections {
  readonly family: Family;
  readonly target: string;
  readonly storage: JsonRecord;
  readonly capabilities: JsonRecord;
  readonly execution: JsonRecord | undefined;
}

type HashSet = { readonly [kind in HashKind]?: string };

function withoutNamespaceKinds(storage: JsonRecord): JsonRecord {
  const namespaces = storage['namespaces'];
  if (!isRecord(namespaces)) return storage;
  const stripped: JsonRecord = {};
  for (const [namespaceId, namespace] of Object.entries(namespaces)) {
    if (isRecord(namespace)) {
      const { kind: _kind, ...rest } = namespace;
      defineOwn(stripped, namespaceId, rest);
    } else {
      defineOwn(stripped, namespaceId, namespace);
    }
  }
  return { ...storage, namespaces: stripped };
}

/** The capabilities the old rule's profile hash covered: none for SQL, the contract's own for MongoDB. */
function oldProfileCapabilities(contract: ContractSections): JsonRecord {
  return contract.family === 'sql' ? {} : contract.capabilities;
}

const OLD_TOP_LEVEL_ORDER = [
  'targetFamily',
  'target',
  'profileHash',
  'roots',
  'domain',
  'storage',
  'execution',
  'capabilities',
  'extensions',
  'meta',
];

/** The hash rule up to this release: the section inside a stand-in contract, with `schemaVersion: "1"` first. */
function oldHash(contract: ContractSections, section: JsonRecord, hooks: Hooks): string {
  const standIn: JsonRecord = {
    targetFamily: contract.family,
    target: contract.target,
    profileHash: '',
    roots: {},
    domain: { namespaces: {} },
    storage: {},
    extensions: {},
    capabilities: {},
    meta: {},
    ...section,
  };
  const canonical = canonicalSections(standIn, hooks);
  const ordered: JsonRecord = { schemaVersion: '1' };
  for (const key of OLD_TOP_LEVEL_ORDER) {
    const value = canonical[key];
    if (value !== undefined) ordered[key] = value;
  }
  return sha256(JSON.stringify(ordered, null, 2));
}

// ---------------------------------------------------------------------------
// The families' normal form of storage under the new rule. The canonicalizer leaves out no value; each family leaves out only the fields it names, and orders the lists whose order has no meaning.

type Normalize = (value: JsonRecord) => JsonRecord;

function without(record: JsonRecord, leaveOut: (key: string, value: Json) => boolean): JsonRecord {
  const kept: JsonRecord = {};
  for (const [key, value] of Object.entries(record)) {
    if (!leaveOut(key, value)) defineOwn(kept, key, value);
  }
  return kept;
}

function withEntry(record: JsonRecord, key: string, value: Json | undefined): JsonRecord {
  if (value === undefined) return record;
  const next: JsonRecord = { ...record };
  defineOwn(next, key, value);
  return next;
}

function mapRecordValues(value: Json | undefined, map: Normalize): Json | undefined {
  if (!isRecord(value)) return value;
  const mapped: JsonRecord = {};
  for (const [key, entry] of Object.entries(value)) {
    defineOwn(mapped, key, isRecord(entry) ? map(entry) : entry);
  }
  return mapped;
}

function mapListItems(value: Json | undefined, map: Normalize): Json | undefined {
  return Array.isArray(value)
    ? value.map((entry) => (isRecord(entry) ? map(entry) : entry))
    : value;
}

const isEmptyRecord = (value: Json): boolean => isRecord(value) && Object.keys(value).length === 0;
const isEmptyList = (value: Json): boolean => Array.isArray(value) && value.length === 0;
const withoutManyFalse: Normalize = (field) =>
  without(field, (key, value) => key === 'many' && value === false);
const withoutEmptyTypeParams: Normalize = (record) =>
  without(record, (key, value) => key === 'typeParams' && isEmptyRecord(value));

function normalFieldType(fieldType: JsonRecord): JsonRecord {
  const kept = withoutEmptyTypeParams(fieldType);
  return withEntry(kept, 'members', mapListItems(kept['members'], withoutEmptyTypeParams));
}

function normalValueObjectField(field: JsonRecord): JsonRecord {
  const kept = withoutManyFalse(field);
  return isRecord(kept['type']) ? withEntry(kept, 'type', normalFieldType(kept['type'])) : kept;
}

function normalValueObject(valueObject: JsonRecord): JsonRecord {
  return withEntry(
    valueObject,
    'fields',
    mapRecordValues(valueObject['fields'], normalValueObjectField),
  );
}

function contentOf(entry: Json): string {
  return JSON.stringify(sortKeys(entry));
}

function compareByNameThenContent(a: Json, b: Json): number {
  return compareByName(a, b) || compareCodeUnits(contentOf(a), contentOf(b));
}

function sortListsOf(
  record: JsonRecord,
  keys: readonly string[],
  compare: (a: Json, b: Json) => number,
): JsonRecord {
  let next = record;
  for (const key of keys) {
    const list = next[key];
    if (Array.isArray(list)) next = withEntry(next, key, [...list].sort(compare));
  }
  return next;
}

function normalStorageWith(entriesOf: Normalize): (storage: JsonRecord) => JsonRecord {
  return (storage) =>
    withEntry(
      storage,
      'namespaces',
      mapRecordValues(storage['namespaces'], (namespace) =>
        isRecord(namespace['entries'])
          ? withEntry(namespace, 'entries', entriesOf(namespace['entries']))
          : namespace,
      ),
    );
}

function sqlIndex(index: JsonRecord): JsonRecord {
  return without(
    index,
    (key, value) =>
      (key === 'columns' && isEmptyList(value)) || (key === 'options' && isEmptyRecord(value)),
  );
}

function sqlForeignKey(foreignKey: JsonRecord): JsonRecord {
  return without(
    foreignKey,
    (key, value) =>
      (key === 'index' && typeof value === 'boolean') ||
      ((key === 'onDelete' || key === 'onUpdate') && value === 'noAction'),
  );
}

function sqlTable(table: JsonRecord): JsonRecord {
  let next = without(table, (key, value) => key === 'checks' && isEmptyList(value));
  next = withEntry(
    next,
    'columns',
    mapRecordValues(next['columns'], (column) => withoutEmptyTypeParams(withoutManyFalse(column))),
  );
  next = withEntry(next, 'indexes', mapListItems(next['indexes'], sqlIndex));
  next = withEntry(next, 'foreignKeys', mapListItems(next['foreignKeys'], sqlForeignKey));
  return sortListsOf(
    next,
    ['checks', 'foreignKeys', 'indexes', 'uniques'],
    compareByNameThenContent,
  );
}

function sqlEntries(entries: JsonRecord): JsonRecord {
  const kept = without(entries, (key, value) => key !== 'table' && isEmptyRecord(value));
  const withTables = withEntry(kept, 'table', mapRecordValues(kept['table'], sqlTable));
  return withEntry(
    withTables,
    'valueObject',
    mapRecordValues(kept['valueObject'], normalValueObject),
  );
}

function sqlNormalStorage(storage: JsonRecord): JsonRecord {
  const withNamespaces = normalStorageWith(sqlEntries)(storage);
  return withEntry(
    withNamespaces,
    'types',
    mapRecordValues(withNamespaces['types'], withoutEmptyTypeParams),
  );
}

const MONGO_FALSE_BY_DEFAULT_COLLATION_FLAGS = new Set(['caseLevel', 'numericOrdering']);
const MONGO_FALSE_BY_DEFAULT_INDEX_FLAGS = new Set(['unique', 'sparse']);
const MONGO_SUBSCHEMA_KEYWORDS = new Set([
  'items',
  'not',
  'additionalProperties',
  'additionalItems',
]);
const MONGO_SUBSCHEMA_LIST_KEYWORDS = new Set(['oneOf', 'anyOf', 'allOf', 'items']);
const MONGO_SUBSCHEMA_MAP_KEYWORDS = new Set(['properties', 'patternProperties', 'dependencies']);

const mongoCollation: Normalize = (collation) =>
  without(
    collation,
    (key, value) => MONGO_FALSE_BY_DEFAULT_COLLATION_FLAGS.has(key) && value === false,
  );

function mongoIndex(index: JsonRecord): JsonRecord {
  const kept = without(
    index,
    (key, value) => MONGO_FALSE_BY_DEFAULT_INDEX_FLAGS.has(key) && value === false,
  );
  return isRecord(kept['collation'])
    ? withEntry(kept, 'collation', mongoCollation(kept['collation']))
    : kept;
}

function mongoJsonSchema(schema: JsonRecord): JsonRecord {
  const kept = without(
    schema,
    (key, value) =>
      (key === 'required' && isEmptyList(value)) || (key === 'properties' && isEmptyRecord(value)),
  );
  const next: JsonRecord = {};
  for (const [key, value] of Object.entries(kept)) {
    let mapped: Json | undefined = value;
    if (MONGO_SUBSCHEMA_MAP_KEYWORDS.has(key)) mapped = mapRecordValues(value, mongoJsonSchema);
    else if (MONGO_SUBSCHEMA_LIST_KEYWORDS.has(key) && Array.isArray(value))
      mapped = mapListItems(value, mongoJsonSchema);
    else if (MONGO_SUBSCHEMA_KEYWORDS.has(key) && isRecord(value)) mapped = mongoJsonSchema(value);
    defineOwn(next, key, mapped ?? value);
  }
  return next;
}

function mongoCollection(collection: JsonRecord): JsonRecord {
  let next = without(collection, (key, value) => key === 'indexes' && isEmptyList(value));
  next = withEntry(next, 'indexes', mapListItems(next['indexes'], mongoIndex));
  next = sortListsOf(next, ['indexes'], compareByNameThenContent);
  const validator = next['validator'];
  if (isRecord(validator) && isRecord(validator['jsonSchema'])) {
    next = withEntry(
      next,
      'validator',
      withEntry(validator, 'jsonSchema', mongoJsonSchema(validator['jsonSchema'])),
    );
  }
  const options = next['options'];
  if (isRecord(options) && isRecord(options['collation'])) {
    next = withEntry(
      next,
      'options',
      withEntry(options, 'collation', mongoCollation(options['collation'])),
    );
  }
  return next;
}

function mongoEntries(entries: JsonRecord): JsonRecord {
  const kept = without(entries, (key, value) => key !== 'collection' && isEmptyRecord(value));
  const withCollections = withEntry(
    kept,
    'collection',
    mapRecordValues(kept['collection'], mongoCollection),
  );
  return withEntry(
    withCollections,
    'valueObject',
    mapRecordValues(kept['valueObject'], normalValueObject),
  );
}

const NEW_NORMAL_STORAGE: Record<Family, Normalize> = {
  sql: sqlNormalStorage,
  mongo: normalStorageWith(mongoEntries),
};

/** The hash rule from this release: the target, the family and the section, with no value left out but the defaults the family names in its storage. The profile hash covers the contract's own capabilities in every family. */
function newHash(contract: ContractSections, section: JsonRecord): string {
  const storage = section['storage'];
  const normal = isRecord(storage)
    ? { ...section, storage: NEW_NORMAL_STORAGE[contract.family](storage) }
    : section;
  const input = { targetFamily: contract.family, target: contract.target, ...normal };
  return sha256(JSON.stringify(sortKeys(input), null, 2));
}

function contractHashes(
  contract: ContractSections,
  rule: (contract: ContractSections, section: JsonRecord, hooks: Hooks) => string,
  profileCapabilities: JsonRecord,
): HashSet {
  const storage = rule(
    contract,
    { storage: withoutNamespaceKinds(contract.storage) },
    storageHooks(contract.family),
  );
  const profile = rule(contract, { capabilities: profileCapabilities }, {});
  if (contract.execution === undefined) return { storage, profile };
  return { storage, profile, execution: rule(contract, { execution: contract.execution }, {}) };
}

function computeMigrationHash(metadata: JsonRecord, ops: Json): string {
  const { migrationHash: _migrationHash, formatVersion: _formatVersion, ...rest } = metadata;
  const parts = [canonicalizeJson(rest), canonicalizeJson(ops)].map(sha256);
  return sha256(canonicalizeJson(parts));
}

// ---------------------------------------------------------------------------
// Finding stored files.

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
  }
}

function errorText(error: unknown): string {
  if (error instanceof Error && 'code' in error) return String(error.code);
  return error instanceof Error ? error.message : String(error);
}

function listDirectory(dir: string): Dirent[] | string {
  try {
    return readdirSync(dir, { withFileTypes: true }).sort((a, b) =>
      compareCodeUnits(a.name, b.name),
    );
  } catch (error) {
    return errorText(error);
  }
}

function isMigrationPackage(dir: string): boolean {
  return existsSync(join(dir, 'migration.json')) && existsSync(join(dir, 'ops.json'));
}

function hasSubdirectory(dir: string, holds: (path: string, name: string) => boolean): boolean {
  const entries = listDirectory(dir);
  return (
    typeof entries !== 'string' &&
    entries.some((entry) => {
      const path = join(dir, entry.name);
      return isDirectory(path) && holds(path, entry.name);
    })
  );
}

function isSnapshotStore(dir: string): boolean {
  return hasSubdirectory(
    dir,
    (path, name) => HASH.test(name) && existsSync(join(path, 'contract.json')),
  );
}

function isMigrationsDirectory(dir: string): boolean {
  return isSnapshotStore(join(dir, 'snapshots')) || hasSubdirectory(dir, isMigrationPackage);
}

function isRefLocation(root: string, path: string): boolean {
  const segments = relative(root, dirname(path)).split(sep);
  for (let i = segments.length - 1; i >= 0; i--) {
    if (segments[i] !== 'refs') continue;
    const owner = join(root, ...segments.slice(0, i));
    if (isMigrationsDirectory(owner)) return true;
    if (i > 0 && SPACE_ID.test(segments[i - 1] ?? '') && isMigrationsDirectory(dirname(owner)))
      return true;
  }
  return false;
}

function isInRefsDirectory(root: string, path: string): boolean {
  return relative(root, dirname(path)).split(sep).includes('refs');
}

function hasRefContent(value: JsonRecord): boolean {
  const hash = value['hash'];
  return (
    typeof hash === 'string' &&
    REF_HASH.test(hash) &&
    Array.isArray(value['invariants']) &&
    value['invariants'].every((item) => typeof item === 'string')
  );
}

function isContract(value: JsonRecord): boolean {
  return typeof value['targetFamily'] === 'string' && isRecord(value['storage']);
}

/** The hash a snapshot's directory is named by, when `path` is a snapshot's `contract.json`. */
function snapshotDirectoryHash(path: string): string | undefined {
  const dir = dirname(path);
  const name = basename(dir);
  return basename(path) === 'contract.json' &&
    HASH.test(name) &&
    basename(dirname(dir)) === 'snapshots'
    ? name
    : undefined;
}

interface StoredText {
  readonly path: string;
  readonly bom: string;
  readonly text: string;
  readonly value: JsonRecord;
}

interface ProjectFiles {
  readonly contracts: StoredText[];
  readonly migrations: StoredText[];
  readonly refs: StoredText[];
  readonly migrationTs: string[];
  readonly unversioned: string[];
  /** Files and directories an interrupted run of this script left behind. */
  readonly leftovers: string[];
}

function emptyFiles(): ProjectFiles {
  return {
    contracts: [],
    migrations: [],
    refs: [],
    migrationTs: [],
    unversioned: [],
    leftovers: [],
  };
}

/** A file's text without a leading byte order mark, and the mark, so a rewrite can keep it. */
function readText(path: string): { readonly bom: string; readonly text: string } {
  const raw = readFileSync(path, 'utf8');
  const bom = raw.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  return { bom, text: raw.slice(bom.length) };
}

function readStored(path: string): StoredText | string {
  let bom: string;
  let text: string;
  try {
    ({ bom, text } = readText(path));
  } catch (error) {
    return `cannot be read (${errorText(error)})`;
  }
  let value: Json;
  try {
    value = JSON.parse(text);
  } catch (error) {
    return `is not valid JSON (${errorText(error)})`;
  }
  if (!isRecord(value)) return 'is not a JSON object';
  return { path, bom, text, value };
}

function classify(
  root: string,
  path: string,
  files: ProjectFiles,
  stops: string[],
  shown: string,
): void {
  const name = basename(path);
  const inPackage = name === 'migration.json' && isMigrationPackage(dirname(path));
  const atRefLocation = !name.endsWith('.contract.json') && isRefLocation(root, path);
  const mustParse = inPackage || atRefLocation || name === 'contract.json';
  const stored = readStored(path);
  if (typeof stored === 'string') {
    if (mustParse) stops.push(`${shown}: ${stored}`);
    return;
  }
  const { value } = stored;
  if (inPackage) {
    files.migrations.push(stored);
  } else if (atRefLocation || (isInRefsDirectory(root, path) && hasRefContent(value))) {
    files.refs.push(stored);
  } else if (isContract(value)) {
    if (value['formatVersion'] === undefined && value['schemaVersion'] === undefined) {
      if (name === 'contract.json') {
        const remedy =
          snapshotDirectoryHash(path) === undefined
            ? 'Emit it again with `prisma contract emit`, or restore it from version control'
            : 'Restore it from version control';
        files.unversioned.push(
          `${shown}: has neither "formatVersion" nor "schemaVersion", so no release of Prisma wrote it; the script leaves it alone. ${remedy}`,
        );
      }
      return;
    }
    files.contracts.push(stored);
  }
}

function isWalked(name: string): boolean {
  return !SKIPPED_DIRECTORIES.has(name) && !name.startsWith('.');
}

function isInside(dir: string, path: string): boolean {
  return path === dir || path.startsWith(`${dir}${sep}`);
}

function visit(root: string, dir: string, files: ProjectFiles, stops: string[]): void {
  const entries = listDirectory(dir);
  if (typeof entries === 'string') {
    stops.push(`${relative(root, dir) || '.'}: directory cannot be read (${entries})`);
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    const shown = relative(root, path);
    if (entry.isDirectory()) {
      if (entry.name.startsWith('.') && entry.name.endsWith(REMOVED_SUFFIX))
        files.leftovers.push(path);
      else if (isWalked(entry.name)) visit(root, path, files, stops);
    } else if (entry.isFile() && entry.name.endsWith(TEMPORARY_SUFFIX)) {
      files.leftovers.push(path);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      classify(root, path, files, stops, shown);
    } else if (entry.isFile() && entry.name === 'migration.ts' && isMigrationPackage(dir)) {
      files.migrationTs.push(path);
    } else if (entry.isSymbolicLink()) {
      checkLink(root, path, entry.name, stops);
    }
  }
}

/** Reports a symbolic link to a file or folder outside the project root that holds stored files; the script does not follow links. */
function checkLink(root: string, path: string, name: string, stops: string[]): void {
  let target: string;
  try {
    target = realpathSync(path);
  } catch {
    return;
  }
  const realRoot = realpathSync(root);
  if (isInside(realRoot, target) || isInside(target, realRoot)) return;
  const probe = emptyFiles();
  const probeStops: string[] = [];
  const targetIsDirectory = isDirectory(target);
  if (targetIsDirectory) {
    if (!isWalked(name)) return;
    visit(target, target, probe, probeStops);
  } else if (name.endsWith('.json')) {
    classify(dirname(target), target, probe, probeStops, name);
  }
  const holds =
    probe.contracts.length + probe.migrations.length + probe.refs.length + probeStops.length > 0;
  if (!holds) return;
  stops.push(
    `${relative(root, path)}: is a symbolic link to ${target}, outside the project, which holds stored files; the script does not follow links. Run it on ${target} as well, or replace the link with what it points to`,
  );
}

// ---------------------------------------------------------------------------
// Planning.

const KIND_LABEL: Record<HashKind, string> = {
  storage: 'storage hash',
  profile: 'profile hash',
  execution: 'execution hash',
};

interface StoredHashes {
  readonly storage: unknown;
  readonly profile: unknown;
  readonly execution: unknown;
}

function storedHashes(value: JsonRecord): StoredHashes {
  const storage = isRecord(value['storage']) ? value['storage'] : {};
  const execution = isRecord(value['execution']) ? value['execution'] : undefined;
  return {
    storage: storage['storageHash'],
    profile: value['profileHash'],
    execution: execution?.['executionHash'],
  };
}

function sectionsOf(value: JsonRecord): ContractSections | string {
  const family = value['targetFamily'];
  if (family !== 'sql' && family !== 'mongo')
    return `its family is ${JSON.stringify(family)}; the script knows the hash rules of the "sql" and "mongo" families only`;
  const target = value['target'];
  if (typeof target !== 'string') return 'it has no "target" string';
  const storage = isRecord(value['storage']) ? value['storage'] : {};
  const { storageHash: _storageHash, ...storageSection } = storage;
  const capabilities = isRecord(value['capabilities']) ? value['capabilities'] : {};
  const executionValue = value['execution'];
  let execution: JsonRecord | undefined;
  if (isRecord(executionValue)) {
    const { executionHash: _executionHash, ...rest } = executionValue;
    execution = rest;
  }
  return { family, target, storage: storageSection, capabilities, execution };
}

interface ContractPlan {
  readonly file: StoredText;
  readonly oldHashes: HashSet;
  readonly newHashes: HashSet;
  readonly snapshotHash: string | undefined;
  /** The hash a MongoDB snapshot is named by when an earlier upgrade step rewrote its content and kept the hash. */
  readonly keptStorageHash: string | undefined;
}

class HashMap {
  readonly byKind: Record<Exclude<HashKind, 'profile'>, Map<string, string>> = {
    storage: new Map(),
    execution: new Map(),
  };
  /**
   * Each old profile hash and a new one it became. The old SQL profile hash covered no capabilities, so contracts of one target with different capabilities share an old value and get different new ones. No file but the contract and its `contract.d.ts` stores a profile hash, so it is replaced contract by contract and only reported here.
   */
  readonly profiles = new Set<string>();
  readonly all = new Map<string, string>();
  readonly newValues = new Set<string>();

  add(kind: HashKind, from: string, to: string, conflicts: string[]): void {
    if (kind === 'profile') {
      if (from !== to) this.profiles.add(`${from} -> ${to}`);
      return;
    }
    const known = this.all.get(from);
    if (known !== undefined && known !== to) {
      conflicts.push(`the hash ${from} maps to both ${known} and ${to}`);
      return;
    }
    this.newValues.add(to);
    if (from === to) return;
    this.all.set(from, to);
    this.byKind[kind].set(from, to);
  }

  /** The new value of `hash`, or undefined when `hash` is neither an old nor a new hash of a contract. */
  resolve(hash: string): string | undefined {
    return this.all.get(hash) ?? (this.newValues.has(hash) ? hash : undefined);
  }

  age(hash: string): 'old' | 'new' | 'unknown' {
    if (this.all.has(hash)) return 'old';
    return this.newValues.has(hash) ? 'new' : 'unknown';
  }
}

/**
 * A MongoDB snapshot may hold a storage hash its content does not give: the index-name and field-storage-name upgrade steps rewrote snapshots in place and kept their hashes, because database markers, the ledger and migrations name a snapshot by its hash. Such a snapshot's directory name is the hash it was kept under. Its stored hash is that hash too, or already the new one when a run of this script stopped before it renamed the directory.
 */
function keptStorageHash(
  family: Family,
  snapshotHash: string | undefined,
  stored: unknown,
  oldHash: string | undefined,
  newHash: string | undefined,
): string | undefined {
  if (family !== 'mongo' || snapshotHash === undefined) return undefined;
  if (snapshotHash === oldHash || snapshotHash === newHash) return undefined;
  return stored === snapshotHash || stored === newHash ? snapshotHash : undefined;
}

function hashList(hashes: HashSet): string {
  const kinds = (['storage', 'profile', 'execution'] as const).filter(
    (kind) => hashes[kind] !== undefined,
  );
  const join = (items: readonly string[]) =>
    items.length < 2 ? items.join('') : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
  return `${join(kinds)} hashes to ${join(kinds.map((kind) => hashes[kind] ?? ''))}`;
}

interface ContractChecks {
  readonly stops: string[];
  /** Contracts the script leaves unchanged and reports, without refusing the project. */
  readonly left: string[];
  /** Snapshots whose profile or execution hash an earlier release wrote by other rules. */
  readonly notes: string[];
  /** Every storage hash a migration, ref or snapshot names. */
  readonly named: ReadonlySet<string>;
}

function planContract(
  file: StoredText,
  shown: string,
  checks: ContractChecks,
): ContractPlan | undefined {
  const sections = sectionsOf(file.value);
  if (typeof sections === 'string') {
    checks.stops.push(`${shown}: ${sections}`);
    return undefined;
  }
  const oldHashes = contractHashes(sections, oldHash, oldProfileCapabilities(sections));
  const newHashes = contractHashes(sections, newHash, sections.capabilities);
  const stored = storedHashes(file.value);
  const snapshotHash = snapshotDirectoryHash(file.path);
  const kept = keptStorageHash(
    sections.family,
    snapshotHash,
    stored.storage,
    oldHashes.storage,
    newHashes.storage,
  );
  const problems: string[] = [];
  const stale: string[] = [];
  for (const kind of ['storage', 'profile', 'execution'] as const) {
    const value = stored[kind];
    const expectedOld = oldHashes[kind];
    if (expectedOld === undefined) continue;
    if (value === expectedOld || value === newHashes[kind]) continue;
    if (kind === 'storage' && kept !== undefined && value === kept) continue;
    if (value === undefined) problems.push(`it has no ${KIND_LABEL[kind]}`);
    else if (kind !== 'storage' && snapshotHash !== undefined) stale.push(KIND_LABEL[kind]);
    else
      problems.push(
        `its ${KIND_LABEL[kind]} ${JSON.stringify(value)} is not the one its content gives, ${expectedOld}`,
      );
  }
  if (
    snapshotHash !== undefined &&
    kept === undefined &&
    snapshotHash !== oldHashes.storage &&
    snapshotHash !== newHashes.storage
  )
    problems.push(
      `its snapshot directory is named ${snapshotHash}, which is not the storage hash its content gives, ${oldHashes.storage}`,
    );
  if (problems.length > 0) {
    const isNamed = typeof stored.storage === 'string' && checks.named.has(stored.storage);
    if (snapshotHash === undefined && !isNamed)
      checks.left.push(
        `${shown}: ${problems.join('; ')}. It is not a snapshot, and no migration, ref or snapshot names its hashes, so the script leaves it alone. If Prisma emits it, emit it again with \`prisma contract emit\`; otherwise set its ${hashList(newHashes)}, the hashes its content gives`,
      );
    else
      checks.stops.push(
        `${shown}: ${problems.join('; ')}. The file was edited by hand or comes from another release: restore it from version control${snapshotHash === undefined ? ', or emit it again,' : ''} and run the script again`,
      );
    return undefined;
  }
  if (stale.length > 0) checks.notes.push(`${shown} (${stale.join(' and ')})`);
  return { file, oldHashes, newHashes, snapshotHash, keptStorageHash: kept };
}

/** Every storage hash a migration's `from` or `to`, a ref, or a snapshot's directory name or stored hash names. */
function namedHashes(files: ProjectFiles): Set<string> {
  const named = new Set<string>();
  const add = (hash: unknown) => {
    if (typeof hash === 'string') named.add(hash);
  };
  for (const { value } of files.migrations) {
    add(value['from']);
    add(value['to']);
  }
  for (const { value } of files.refs) add(value['hash']);
  for (const { path, value } of files.contracts) {
    const snapshotHash = snapshotDirectoryHash(path);
    if (snapshotHash === undefined) continue;
    add(snapshotHash);
    add(storedHashes(value).storage);
  }
  return named;
}

/**
 * The hashes no contract of the project has that a migration links, through the `from` and `to` of other migrations, only to hashes that already have their new value. Prisma copies an extension's migrations into an application without a snapshot of each contract in between, and after `prisma contract emit` writes them again from an upgraded extension, they name those contracts by their new hashes.
 */
function unknownHashesAlreadyNew(migrations: readonly StoredText[], hashes: HashMap): Set<string> {
  const neighbours = new Map<string, string[]>();
  for (const { value } of migrations) {
    const ends = [value['from'], value['to']].filter(
      (hash): hash is string => typeof hash === 'string' && HASH.test(hash),
    );
    for (const hash of ends) if (!neighbours.has(hash)) neighbours.set(hash, []);
    const [from, to] = ends;
    if (from !== undefined && to !== undefined) {
      neighbours.get(from)?.push(to);
      neighbours.get(to)?.push(from);
    }
  }
  const alreadyNew = new Set<string>();
  const seen = new Set<string>();
  for (const start of neighbours.keys()) {
    if (seen.has(start)) continue;
    const component: string[] = [];
    const pending = [start];
    seen.add(start);
    for (let hash = pending.pop(); hash !== undefined; hash = pending.pop()) {
      component.push(hash);
      for (const next of neighbours.get(hash) ?? [])
        if (!seen.has(next)) {
          seen.add(next);
          pending.push(next);
        }
    }
    const ages = new Set(component.map((hash) => hashes.age(hash)));
    if (ages.has('new') && !ages.has('old'))
      for (const hash of component) if (hashes.age(hash) === 'unknown') alreadyNew.add(hash);
  }
  return alreadyNew;
}

/** `text` with each quoted occurrence of a key of `replacements` replaced by its value. */
function replaceQuoted(text: string, replacements: ReadonlyMap<string, string>): string {
  return text.replace(/"([0-9a-f]{64})"/g, (match: string, hash: string) => {
    const next = replacements.get(hash);
    return next === undefined ? match : `"${next}"`;
  });
}

function replaceTokens(text: string, replacements: ReadonlyMap<string, string>): string {
  return text.replace(
    /(?<![0-9a-f])[0-9a-f]{64}(?![0-9a-f])/g,
    (hash: string) => replacements.get(hash) ?? hash,
  );
}

function withHashes(value: JsonRecord, hashes: HashSet): JsonRecord {
  const storage = isRecord(value['storage']) ? value['storage'] : {};
  const execution = value['execution'];
  return {
    ...value,
    profileHash: hashes.profile ?? null,
    storage: { ...storage, storageHash: hashes.storage ?? null },
    ...(isRecord(execution) && hashes.execution !== undefined
      ? { execution: { ...execution, executionHash: hashes.execution } }
      : {}),
  };
}

/** Each hash the contract stores, the old hash its content gives, and a snapshot's directory name, mapped to the new hash its content gives. */
function storedReplacements(plan: ContractPlan): Map<string, string> {
  const stored = storedHashes(plan.file.value);
  const replacements = new Map<string, string>();
  for (const kind of ['storage', 'profile', 'execution'] as const) {
    const to = plan.newHashes[kind];
    if (to === undefined) continue;
    const from = [stored[kind], plan.oldHashes[kind]];
    if (kind === 'storage') from.push(plan.snapshotHash);
    for (const hash of from)
      if (typeof hash === 'string' && hash !== to) replacements.set(hash, to);
  }
  return replacements;
}

/** The contract file's text with its stored hashes replaced by the new ones, or undefined when that edit would change anything else. */
function rewrittenContract(plan: ContractPlan): string | undefined {
  const { value, text } = plan.file;
  const replacements = storedReplacements(plan);
  if (replacements.size === 0) return text;
  const next = replaceQuoted(text, replacements);
  return canonicalizeJson(JSON.parse(next)) === canonicalizeJson(withHashes(value, plan.newHashes))
    ? next
    : undefined;
}

function dtsPathOf(contractPath: string): string {
  return `${contractPath.slice(0, -'.json'.length)}.d.ts`;
}

const DTS_HASH = /\b(Storage|Profile|Execution)HashBase<\s*(['"])([0-9a-f]{64})\2\s*>/g;
const DTS_KIND: Record<string, HashKind> = {
  Storage: 'storage',
  Profile: 'profile',
  Execution: 'execution',
};

/** The `contract.d.ts` text with the contract's old hashes replaced, or a reason it cannot be. */
function rewrittenDts(text: string, plan: ContractPlan): string | { readonly problem: string } {
  const next = replaceTokens(text, storedReplacements(plan));
  const stale = [...next.matchAll(DTS_HASH)]
    .filter((match) => {
      const kind = DTS_KIND[match[1] ?? ''];
      return kind === undefined || plan.newHashes[kind] !== match[3];
    })
    .map((match) => match[0]);
  if (stale.length === 0) return next;
  return {
    problem: `names ${stale.join(', ')}, which is not a hash of the contract beside it; emit the contract again with \`prisma contract emit\`, or, for a snapshot, restore both files from version control`,
  };
}

interface Plan {
  readonly writes: Map<string, string>;
  readonly renames: [string, string][];
  readonly removals: string[];
  readonly notes: string[];
  readonly kept: string[];
  readonly merged: string[];
  /** Old snapshot directories removed because `prisma contract emit` already wrote their contract under its new storage hash. */
  readonly superseded: string[];
  readonly problems: string[];
}

function main(args: readonly string[]): number {
  if (args.length > 1 || args.some((arg) => arg.startsWith('-'))) {
    process.stderr.write('Usage: node contract-hash-inputs.ts [project-root]\n');
    return 1;
  }
  const root = resolve(args[0] ?? process.cwd());
  if (!isDirectory(root)) {
    process.stderr.write(`${root}: not a directory\n`);
    return 1;
  }
  const shown = (path: string) => relative(root, path).split(sep).join('/');
  const files = emptyFiles();
  const stops: string[] = [];
  visit(root, root, files, stops);
  if (stops.length > 0) return refuse(stops);

  const contracts: ContractPlan[] = [];
  const checks: ContractChecks = {
    stops,
    left: [...files.unversioned],
    notes: [],
    named: namedHashes(files),
  };
  for (const file of files.contracts) {
    const plan = planContract(file, shown(file.path), checks);
    if (plan !== undefined) contracts.push(plan);
  }
  const hashes = new HashMap();
  const kept: string[] = [];
  for (const plan of contracts) {
    for (const kind of ['storage', 'profile', 'execution'] as const) {
      const from = plan.oldHashes[kind];
      const to = plan.newHashes[kind];
      if (from !== undefined && to !== undefined) hashes.add(kind, from, to, stops);
    }
    const to = plan.newHashes.storage;
    if (plan.keptStorageHash === undefined || to === undefined) continue;
    hashes.add('storage', plan.keptStorageHash, to, stops);
    kept.push(`${shown(plan.file.path)} (${plan.keptStorageHash} -> ${to})`);
  }
  if (stops.length > 0) return refuse(stops);

  const plan: Plan = {
    writes: new Map(),
    renames: [],
    removals: [],
    notes: checks.notes,
    kept,
    merged: [],
    superseded: [],
    problems: checks.left,
  };
  const alreadyNew = unknownHashesAlreadyNew(files.migrations, hashes);
  const newValueOf = (hash: string) =>
    hashes.resolve(hash) ?? (alreadyNew.has(hash) ? hash : undefined);
  planMigrations(files, hashes, newValueOf, plan, stops, shown);
  planRefs(files, newValueOf, plan, shown);
  planContracts(contracts, plan, stops, shown);
  if (stops.length > 0) return refuse(stops);
  for (const path of files.migrationTs) {
    const { text } = readText(path);
    const next = replaceTokens(text, hashes.byKind.storage);
    if (next !== text) plan.writes.set(path, next);
  }

  const written: string[] = [];
  try {
    for (const path of files.leftovers) rmSync(path, { recursive: true, force: true });
    for (const [path, text] of plan.writes) {
      const current = readText(path);
      if (current.text === text) continue;
      replaceFile(path, current.bom + text);
      written.push(path);
    }
    for (const dir of plan.removals) {
      const removed = join(dirname(dir), `.${basename(dir)}${REMOVED_SUFFIX}`);
      renameSync(dir, removed);
      rmSync(removed, { recursive: true, force: true });
    }
    for (const [from, to] of plan.renames) renameSync(from, to);
  } catch (error) {
    process.stderr.write(
      `${errorText(error)}; the upgrade stopped partway. Run the script again to finish it\n`,
    );
    return 1;
  }
  report(
    written.map((path) => shown(renamedPath(path, plan.renames))),
    plan,
    hashes,
    shown,
  );
  if (plan.problems.length === 0) return 0;
  process.stderr.write(`Left unchanged:\n${plan.problems.map((line) => `  ${line}\n`).join('')}`);
  return 1;
}

/** Writes the new text beside the file and renames it over the file, so a run that stops leaves each file either as it was or as it should be. */
function replaceFile(path: string, text: string): void {
  const temporary = `${path}${TEMPORARY_SUFFIX}`;
  writeFileSync(temporary, text);
  chmodSync(temporary, statSync(path).mode & 0o7777);
  renameSync(temporary, path);
}

function refuse(stops: readonly string[]): number {
  process.stderr.write(
    `Changed no file, because:\n${[...new Set(stops)].map((line) => `  ${line}\n`).join('')}`,
  );
  return 1;
}

/**
 * Plans each migration's new `from`, `to`, `ops.json` and `migrationHash`. The script writes a `migration.json` before the `ops.json` beside it, so a run that stopped between the two leaves a `migrationHash` that covers the new `ops.json`; such a migration is finished, not refused.
 */
function planMigrations(
  files: ProjectFiles,
  hashes: HashMap,
  newValueOf: (hash: string) => string | undefined,
  plan: Plan,
  stops: string[],
  shown: (path: string) => string,
): void {
  for (const file of files.migrations) {
    const { value, text } = file;
    const opsPath = join(dirname(file.path), 'ops.json');
    let opsText: string;
    let ops: Json;
    try {
      opsText = readText(opsPath).text;
      ops = JSON.parse(opsText);
    } catch (error) {
      stops.push(`${shown(opsPath)}: cannot be read as JSON (${errorText(error)})`);
      continue;
    }
    const stored = value['migrationHash'];
    const nextOpsText = replaceQuoted(opsText, hashes.byKind.storage);
    const opsLeftBehind =
      nextOpsText !== opsText && stored === computeMigrationHash(value, JSON.parse(nextOpsText));
    if (stored !== computeMigrationHash(value, ops) && !opsLeftBehind) {
      stops.push(
        `${shown(file.path)}: its "migrationHash" is not the hash of the migration; it was edited by hand. Restore it from version control, or plan the migration again, and run the script again`,
      );
      continue;
    }
    const next: JsonRecord = { ...value };
    const unknown: string[] = [];
    for (const field of ['from', 'to'] as const) {
      const hash = value[field];
      if (typeof hash !== 'string' || !HASH.test(hash)) continue;
      const resolved = newValueOf(hash);
      if (resolved === undefined) unknown.push(`its "${field}", ${hash}`);
      else next[field] = resolved;
    }
    if (unknown.length > 0) {
      plan.problems.push(
        `${shown(file.path)}: ${unknown.join(' and ')}, ${UNKNOWN_HASH} If the migration is in an extension's folder, migrations/<extension>/, Prisma copied it from the extension: delete its folder, and \`prisma contract emit\` writes it again from the upgraded extension. Otherwise restore the snapshot from version control and run the script again`,
      );
      continue;
    }
    if (next['from'] === value['from'] && next['to'] === value['to'] && nextOpsText === opsText)
      continue;
    const nextOps: Json = JSON.parse(nextOpsText);
    const migrationHash = computeMigrationHash(next, nextOps);
    next['migrationHash'] = migrationHash;
    const replacements = new Map<string, string>();
    for (const field of ['from', 'to', 'migrationHash'] as const) {
      const from = value[field];
      const to = next[field];
      if (typeof from === 'string' && typeof to === 'string' && from !== to)
        replacements.set(from, to);
    }
    const rewritten = replaceQuoted(text, replacements);
    if (canonicalizeJson(JSON.parse(rewritten)) !== canonicalizeJson(next)) {
      plan.problems.push(
        `${shown(file.path)}: could not be rewritten without changing other content; set "from", "to" and "migrationHash" by hand to ${JSON.stringify(next['from'])}, ${JSON.stringify(next['to'])} and "${migrationHash}"`,
      );
      continue;
    }
    plan.writes.set(file.path, rewritten);
    if (nextOpsText !== opsText) plan.writes.set(opsPath, nextOpsText);
  }
}

function planRefs(
  files: ProjectFiles,
  newValueOf: (hash: string) => string | undefined,
  plan: Plan,
  shown: (path: string) => string,
): void {
  for (const file of files.refs) {
    const hash = file.value['hash'];
    if (typeof hash !== 'string' || !HASH.test(hash)) continue;
    const resolved = newValueOf(hash);
    if (resolved === undefined) {
      plan.problems.push(
        `${shown(file.path)}: its "hash", ${hash}, ${UNKNOWN_HASH} If the ref is migrations/<extension>/refs/head.json, \`prisma contract emit\` writes it again from the upgraded extension. Otherwise set the ref again with \`prisma migration ref set\` after the upgrade`,
      );
      continue;
    }
    if (resolved !== hash)
      plan.writes.set(file.path, replaceQuoted(file.text, new Map([[hash, resolved]])));
  }
}

function planContracts(
  contracts: readonly ContractPlan[],
  plan: Plan,
  stops: string[],
  shown: (path: string) => string,
): void {
  const targets = new Map<string, string>();
  const storageHashByPath = new Map(
    contracts.map((contract) => [contract.file.path, contract.newHashes.storage]),
  );
  for (const contract of contracts) {
    const path = contract.file.path;
    const text = rewrittenContract(contract);
    if (text === undefined) {
      plan.problems.push(
        `${shown(path)}: could not be rewritten without changing other content; set its storage, profile and execution hashes by hand to ${[contract.newHashes.storage, contract.newHashes.profile, contract.newHashes.execution].filter((hash) => hash !== undefined).join(', ')}`,
      );
      continue;
    }
    plan.writes.set(path, text);
    const dtsPath = dtsPathOf(path);
    let dtsText: string | undefined;
    if (existsSync(dtsPath)) {
      const dts = rewrittenDts(readText(dtsPath).text, contract);
      if (typeof dts === 'string') {
        plan.writes.set(dtsPath, dts);
        dtsText = dts;
      } else {
        plan.problems.push(`${shown(dtsPath)}: ${dts.problem}`);
      }
    }
    const from = contract.snapshotHash;
    const to = contract.newHashes.storage;
    if (from === undefined || to === undefined || from === to) continue;
    const oldDir = dirname(path);
    const newDir = join(dirname(oldDir), to);
    const content = snapshotContent(oldDir, text, dtsText);
    const planned = targets.get(newDir);
    if (planned !== undefined || existsSync(newDir)) {
      const existing = planned ?? snapshotContent(newDir, undefined, undefined);
      if (existing !== content) {
        const existingHash = storageHashByPath.get(join(newDir, 'contract.json'));
        if (planned === undefined && existingHash === to) {
          plan.writes.delete(path);
          plan.writes.delete(join(oldDir, 'contract.d.ts'));
          plan.removals.push(oldDir);
          plan.superseded.push(`${shown(oldDir)} (kept ${shown(newDir)}/)`);
          continue;
        }
        stops.push(
          `${shown(oldDir)}: becomes snapshots/${to}/, which already exists with other content. Compare the two directories, keep the right one, and run the script again`,
        );
        continue;
      }
      plan.writes.delete(path);
      plan.writes.delete(join(oldDir, 'contract.d.ts'));
      plan.removals.push(oldDir);
      plan.merged.push(`${shown(oldDir)}, the same as snapshots/${to}/`);
      continue;
    }
    targets.set(newDir, content);
    plan.renames.push([oldDir, newDir]);
  }
}

/** The files of a snapshot directory, with `contract.json` and `contract.d.ts` as they will be written, for comparing two directories. */
function snapshotContent(
  dir: string,
  contractJson: string | undefined,
  dts: string | undefined,
): string {
  const entries = listDirectory(dir);
  if (typeof entries === 'string') return '';
  const files = entries
    .filter((entry) => entry.isFile() && !entry.name.endsWith(TEMPORARY_SUFFIX))
    .map((entry) => {
      const path = join(dir, entry.name);
      const text =
        entry.name === 'contract.json' && contractJson !== undefined
          ? contractJson
          : entry.name === 'contract.d.ts' && dts !== undefined
            ? dts
            : readText(path).text;
      return [entry.name, text];
    });
  return JSON.stringify(files);
}

/** Where `path` is after its snapshot directory was renamed. */
function renamedPath(path: string, renames: readonly [string, string][]): string {
  for (const [from, to] of renames) if (isInside(from, path)) return to + path.slice(from.length);
  return path;
}

function report(
  written: readonly string[],
  plan: Plan,
  hashes: HashMap,
  shown: (path: string) => string,
): void {
  const lines: string[] = [];
  if (written.length === 0 && plan.renames.length === 0 && plan.removals.length === 0) {
    lines.push(
      plan.problems.length === 0
        ? 'Every stored hash already has the value this release computes; nothing changed.'
        : 'Changed no file.',
    );
  } else {
    lines.push(`Rewrote ${written.length} ${written.length === 1 ? 'file' : 'files'}:`);
    lines.push(...[...written].sort(compareCodeUnits).map((path) => `  ${path}`));
    if (plan.renames.length > 0) {
      lines.push('Renamed snapshot directories:');
      lines.push(...plan.renames.map(([from, to]) => `  ${shown(from)} -> ${basename(to)}`));
    }
    for (const kind of ['storage', 'profile', 'execution'] as const) {
      const changed =
        kind === 'profile'
          ? [...hashes.profiles]
          : [...hashes.byKind[kind]].map(([from, to]) => `${from} -> ${to}`);
      if (changed.length === 0) continue;
      lines.push(
        `${KIND_LABEL[kind][0]?.toUpperCase()}${KIND_LABEL[kind].slice(1)}es (old -> new):`,
      );
      lines.push(...changed.sort(compareCodeUnits).map((pair) => `  ${pair}`));
    }
  }
  if (plan.kept.length > 0)
    lines.push(
      'MongoDB snapshots whose content an earlier upgrade step rewrote without changing their storage hash. They now have the storage hash their content gives, and so does every file that names them:',
      ...plan.kept.map((note) => `  ${note}`),
    );
  if (plan.notes.length > 0)
    lines.push(
      "Snapshots whose profile or execution hash an earlier release wrote by other rules, which no version of the files corrects. They now have the hashes their content gives, so `prisma db sign <contract reference>`, which copies a snapshot's profile hash into the database marker, copies the right one:",
      ...plan.notes.map((note) => `  ${note}`),
    );
  if (plan.merged.length > 0)
    lines.push(
      'Snapshot directories that held the same contract as another one, and were removed:',
      ...plan.merged.map((note) => `  ${note}`),
    );
  if (plan.superseded.length > 0)
    lines.push(
      'Snapshot directories whose new name already held a snapshot with the same storage hash, which `prisma contract emit` wrote with this release. The script kept that snapshot unchanged and removed the old directory:',
      ...plan.superseded.map((note) => `  ${note}`),
    );
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exitCode = main(process.argv.slice(2));
