#!/usr/bin/env node
/**
 * Gives every stored contract hash in a project the value this release computes. A contract's storage, profile and execution hashes used to cover a stand-in contract: the section, plus `schemaVersion: "1"` and blank `profileHash`, `roots`, `domain`, `extensions`, `meta` and `capabilities`. They now cover only the target, the family and their own section. The canonicalization rules are otherwise unchanged.
 *
 * Usage: node contract-hash-inputs.ts [project-root]
 *
 * The project root defaults to the working directory. The script reads and writes files only; it needs no database. It walks the root, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot, and finds stored files the way the `stored-files-format-version` script does: a contract by its content (`targetFamily` and `storage`) in any `*.json` file, a `migration.json` by the `ops.json` next to it, and a ref file by where Prisma writes refs or by its content.
 *
 * First it checks every contract: each stored `storageHash`, `profileHash` and `executionHash`, and each snapshot directory's name, must be the hash the old rules or the new rules give the contract's content. Then it checks each `migration.json` against its `migrationHash`, and that each `from`, `to` and ref `hash` names a contract of the project. If any check fails, or a stored file has no `formatVersion`, it changes no file, prints one line per problem and exits 1. A hash that does not match the content means the file was edited by hand or comes from another release; fix that first.
 *
 * Otherwise it rewrites: the three hashes in every contract; the same hashes in the `contract.d.ts` beside it; each snapshot directory's name; `from`, `to` and `migrationHash` in every `migration.json`; `hash` in every ref file; and every old storage hash in every `migration.ts` (snapshot import paths and hash literals). It edits each file's text in place, so every other byte stays. It prints what it changed and each hash it replaced. A `contract.d.ts` whose hashes it cannot match with its contract is reported, left unchanged, and makes it exit 1. A second run changes nothing.
 *
 * The hash rules, old and new, the families' canonicalization hooks and the migration hash rule are copied from Prisma's packages, because a project's strict `node_modules` does not expose them.
 */
import { createHash } from 'node:crypto';
import {
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
const FORMAT_VERSION_STEP =
  'run the `stored-files-format-version` script of the earlier upgrade step first, then this script again';

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

/** The capabilities a family's profile hash covers: none for SQL, the contract's own for MongoDB. */
function profileCapabilities(contract: ContractSections): JsonRecord {
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

/** The hash rule from this release: the target, the family and the section. */
function newHash(contract: ContractSections, section: JsonRecord, hooks: Hooks): string {
  const input = { targetFamily: contract.family, target: contract.target, ...section };
  return sha256(JSON.stringify(canonicalSections(input, hooks), null, 2));
}

function contractHashes(
  contract: ContractSections,
  rule: (contract: ContractSections, section: JsonRecord, hooks: Hooks) => string,
): HashSet {
  const storage = rule(
    contract,
    { storage: withoutNamespaceKinds(contract.storage) },
    storageHooks(contract.family),
  );
  const profile = rule(contract, { capabilities: profileCapabilities(contract) }, {});
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
}

function emptyFiles(): ProjectFiles {
  return { contracts: [], migrations: [], refs: [], migrationTs: [], unversioned: [] };
}

function readStored(path: string): StoredText | string {
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    return `cannot be read (${errorText(error)})`;
  }
  const bom = raw.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  const text = raw.slice(bom.length);
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
      if (name === 'contract.json')
        files.unversioned.push(
          `${shown}: has neither "formatVersion" nor "schemaVersion", so no release of Prisma wrote it; the script leaves it alone. Emit it again with \`prisma contract emit\`, or restore it from version control`,
        );
      return;
    }
    files.contracts.push(stored);
  } else {
    return;
  }
  if (value['formatVersion'] === undefined)
    stops.push(`${shown}: has no "formatVersion"; ${FORMAT_VERSION_STEP}`);
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
      if (isWalked(entry.name)) visit(root, path, files, stops);
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
}

class HashMap {
  readonly byKind: Record<HashKind, Map<string, string>> = {
    storage: new Map(),
    profile: new Map(),
    execution: new Map(),
  };
  readonly all = new Map<string, string>();
  readonly newValues = new Set<string>();

  add(kind: HashKind, from: string, to: string, conflicts: string[]): void {
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
}

function planContract(
  file: StoredText,
  shown: string,
  stops: string[],
  notes: string[],
): ContractPlan | undefined {
  const sections = sectionsOf(file.value);
  if (typeof sections === 'string') {
    stops.push(`${shown}: ${sections}`);
    return undefined;
  }
  const oldHashes = contractHashes(sections, oldHash);
  const newHashes = contractHashes(sections, newHash);
  const stored = storedHashes(file.value);
  const snapshotHash = snapshotDirectoryHash(file.path);
  const problems: string[] = [];
  const stale: string[] = [];
  for (const kind of ['storage', 'profile', 'execution'] as const) {
    const value = stored[kind];
    const expectedOld = oldHashes[kind];
    if (expectedOld === undefined) continue;
    if (value === expectedOld || value === newHashes[kind]) continue;
    if (value === undefined) problems.push(`it has no ${KIND_LABEL[kind]}`);
    else if (kind !== 'storage' && snapshotHash !== undefined) stale.push(KIND_LABEL[kind]);
    else
      problems.push(
        `its ${KIND_LABEL[kind]} ${JSON.stringify(value)} is not the one its content gives, ${expectedOld}`,
      );
  }
  if (
    snapshotHash !== undefined &&
    snapshotHash !== oldHashes.storage &&
    snapshotHash !== newHashes.storage
  )
    problems.push(
      `its snapshot directory is named ${snapshotHash}, which is not the storage hash its content gives, ${oldHashes.storage}`,
    );
  if (problems.length > 0) {
    stops.push(
      `${shown}: ${problems.join('; ')}. The file was edited by hand or comes from another release: restore it from version control, or emit it again, and run the script again`,
    );
    return undefined;
  }
  if (stale.length > 0) notes.push(`${shown} (${stale.join(' and ')})`);
  return { file, oldHashes, newHashes, snapshotHash };
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

/** Each hash the contract stores, and the old hash its content gives, mapped to the new hash its content gives. */
function storedReplacements(plan: ContractPlan): Map<string, string> {
  const stored = storedHashes(plan.file.value);
  const replacements = new Map<string, string>();
  for (const kind of ['storage', 'profile', 'execution'] as const) {
    const to = plan.newHashes[kind];
    if (to === undefined) continue;
    for (const from of [stored[kind], plan.oldHashes[kind]])
      if (typeof from === 'string' && from !== to) replacements.set(from, to);
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
  readonly merged: string[];
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
  const notes: string[] = [];
  for (const file of files.contracts) {
    const plan = planContract(file, shown(file.path), stops, notes);
    if (plan !== undefined) contracts.push(plan);
  }
  const hashes = new HashMap();
  for (const plan of contracts)
    for (const kind of ['storage', 'profile', 'execution'] as const) {
      const from = plan.oldHashes[kind];
      const to = plan.newHashes[kind];
      if (from !== undefined && to !== undefined) hashes.add(kind, from, to, stops);
    }
  if (stops.length > 0) return refuse(stops);

  const plan: Plan = {
    writes: new Map(),
    renames: [],
    removals: [],
    notes,
    merged: [],
    problems: [...files.unversioned],
  };
  planMigrations(files, hashes, plan, stops, shown);
  planRefs(files, hashes, plan, shown);
  planContracts(contracts, plan, stops, shown);
  if (stops.length > 0) return refuse(stops);
  for (const path of files.migrationTs) {
    const text = readFileSync(path, 'utf8');
    const next = replaceTokens(text, hashes.byKind.storage);
    if (next !== text) plan.writes.set(path, next);
  }

  const written: string[] = [];
  try {
    for (const [path, text] of plan.writes) {
      const current = readFileSync(path, 'utf8');
      const bom = current.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
      if (bom + text === current || text === current) continue;
      writeFileSync(path, bom + text);
      written.push(path);
    }
    for (const dir of plan.removals) rmSync(dir, { recursive: true, force: true });
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

function refuse(stops: readonly string[]): number {
  process.stderr.write(
    `Changed no file, because:\n${[...new Set(stops)].map((line) => `  ${line}\n`).join('')}`,
  );
  return 1;
}

function planMigrations(
  files: ProjectFiles,
  hashes: HashMap,
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
      opsText = readFileSync(opsPath, 'utf8');
      ops = JSON.parse(opsText);
    } catch (error) {
      stops.push(`${shown(opsPath)}: cannot be read as JSON (${errorText(error)})`);
      continue;
    }
    const stored = value['migrationHash'];
    if (stored !== computeMigrationHash(value, ops)) {
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
      const resolved = hashes.resolve(hash);
      if (resolved === undefined) unknown.push(`its "${field}", ${hash}`);
      else next[field] = resolved;
    }
    if (unknown.length > 0) {
      plan.problems.push(
        `${shown(file.path)}: ${unknown.join(' and ')}, ${UNKNOWN_HASH} If the migration is in an extension's folder, migrations/<extension>/, Prisma copied it from the extension: delete its folder, and \`prisma contract emit\` writes it again from the upgraded extension. Otherwise restore the snapshot from version control and run the script again`,
      );
      continue;
    }
    const nextOpsText = replaceQuoted(opsText, hashes.byKind.storage);
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
  hashes: HashMap,
  plan: Plan,
  shown: (path: string) => string,
): void {
  for (const file of files.refs) {
    const hash = file.value['hash'];
    if (typeof hash !== 'string' || !HASH.test(hash)) continue;
    const resolved = hashes.resolve(hash);
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
      const dts = rewrittenDts(readFileSync(dtsPath, 'utf8'), contract);
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
    .filter((entry) => entry.isFile())
    .map((entry) => {
      const path = join(dir, entry.name);
      const text =
        entry.name === 'contract.json' && contractJson !== undefined
          ? contractJson
          : entry.name === 'contract.d.ts' && dts !== undefined
            ? dts
            : readFileSync(path, 'utf8');
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
      const changed = [...hashes.byKind[kind]].sort(([a], [b]) => compareCodeUnits(a, b));
      if (changed.length === 0) continue;
      lines.push(
        `${KIND_LABEL[kind][0]?.toUpperCase()}${KIND_LABEL[kind].slice(1)}es (old -> new):`,
      );
      lines.push(...changed.map(([from, to]) => `  ${from} -> ${to}`));
    }
  }
  if (plan.notes.length > 0)
    lines.push(
      'Snapshots whose profile or execution hash an earlier release wrote by other rules. They now have the hashes their content gives; no command reads these two hashes from a snapshot:',
      ...plan.notes.map((note) => `  ${note}`),
    );
  if (plan.merged.length > 0)
    lines.push(
      'Snapshot directories that held the same contract as another one, and were removed:',
      ...plan.merged.map((note) => `  ${note}`),
    );
  process.stdout.write(`${lines.join('\n')}\n`);
}

process.exitCode = main(process.argv.slice(2));
