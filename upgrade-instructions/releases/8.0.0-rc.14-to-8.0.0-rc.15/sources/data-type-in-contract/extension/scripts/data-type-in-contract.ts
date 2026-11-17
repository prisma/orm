#!/usr/bin/env node
/**
 * Rewrites every SQL contract in a project from `nativeType` to `dataType`, and a list stored as
 * `many: true` to `many: { elementNullable: false }`, then renames the snapshot directories and
 * rewrites every migration, ref, `migration.ts` and `contract.d.ts` that names an old storage hash.
 *
 * Usage: node data-type-in-contract.ts [project-root] [--data-type <codec id>=<data type id>]...
 *
 * `--data-type` names the data type of a codec the script's table does not know for a contract's
 * target, such as an extension's own codec. It cannot change the data type of a codec the table
 * knows for that target.
 *
 * The project root defaults to the working directory. The script reads and writes files only. It
 * needs no database, network or configured stack, and a project already in the new format is left
 * unchanged. When it stops (an unknown codec, or a snapshot directory that already exists with
 * different content) it changes no file, prints one line per case and exits 1. When it finishes it
 * prints how many files and snapshot directories it changed and each storage hash it replaced.
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

const DATA_TYPES: Readonly<Record<string, Readonly<Record<string, string>>>> = {
  postgres: {
    'pg/text@1': 'pg/text',
    'pg/text-array@1': 'pg/text-array',
    'pg/enum@1': 'pg/enum',
    'pg/char@1': 'pg/char',
    'pg/varchar@1': 'pg/varchar',
    'pg/int@1': 'pg/int4',
    'pg/int2@1': 'pg/int2',
    'pg/int4@1': 'pg/int4',
    'pg/int8@1': 'pg/int8',
    'pg/int8number@1': 'pg/int8',
    'pg/float@1': 'pg/float8',
    'pg/float4@1': 'pg/float4',
    'pg/float8@1': 'pg/float8',
    'pg/numeric@1': 'pg/numeric',
    'pg/unboundedint@1': 'pg/numeric',
    'pg/bool@1': 'pg/bool',
    'pg/bit@1': 'pg/bit',
    'pg/varbit@1': 'pg/varbit',
    'pg/bytea@1': 'pg/bytea',
    'pg/uuid@1': 'pg/uuid',
    'pg/inet@1': 'pg/inet',
    'pg/tsquery@1': 'pg/tsquery',
    'pg/interval@1': 'pg/interval',
    'pg/json@1': 'pg/json',
    'pg/jsonb@1': 'pg/jsonb',
    'pg/timetz@1': 'pg/timetz',
    'pg/date-temporal@1': 'pg/date',
    'pg/timestamp-temporal@1': 'pg/timestamp',
    'pg/timestamptz-temporal@1': 'pg/timestamptz',
    'pg/time-temporal@1': 'pg/time',
    'pg/date-string@1': 'pg/date',
    'pg/timestamp-string@1': 'pg/timestamp',
    'pg/timestamptz-string@1': 'pg/timestamptz',
    'pg/time-string@1': 'pg/time',
    'pg/timestamptz-date@1': 'pg/timestamptz',
    'pg/timestamptz@1': 'pg/timestamptz',
    'pg/timestamp@1': 'pg/timestamp',
    'pg/time@1': 'pg/time',
    'pg/date@1': 'pg/date',
    'sql/char@1': 'pg/char',
    'sql/varchar@1': 'pg/varchar',
    'sql/int@1': 'pg/int4',
    'sql/float@1': 'pg/float8',
    'sql/text@1': 'pg/text',
    'sql/timestamp@1': 'pg/timestamptz',
    'pg/vector@1': 'pgvector/vector',
    'pg/geometry@1': 'postgis/geometry',
    'arktype/json@1': 'pg/jsonb',
  },
  sqlite: {
    'sqlite/text@1': 'sqlite/text',
    'sqlite/json@1': 'sqlite/text',
    'sqlite/datetime@1': 'sqlite/text',
    'sqlite/integer@1': 'sqlite/integer',
    'sqlite/bigint@1': 'sqlite/integer',
    'sqlite/bigintnumber@1': 'sqlite/integer',
    'sql/int@1': 'sqlite/integer',
    'sqlite/real@1': 'sqlite/real',
    'sql/float@1': 'sqlite/real',
    'sqlite/blob@1': 'sqlite/blob',
    'sql/char@1': 'sqlite/character',
    'sql/varchar@1': 'sqlite/character-varying',
  },
};

const SQLITE_INTEGER_CODECS = new Set([
  'sqlite/integer@1',
  'sql/int@1',
  'sqlite/bigint@1',
  'sqlite/bigintnumber@1',
]);
const SQLITE_JSON_CODEC = 'sqlite/json@1';
const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);
const HASH = /^[0-9a-f]{64}$/;
const TEMPORARY_SUFFIX = '.data-type-in-contract-tmp';

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
const NATIVE_TYPE_PATHS: readonly (readonly PathSegment[])[] = [
  ...COLUMN_PATHS,
  ['storage', 'types', '*'],
];
const LIST_PATHS: readonly (readonly PathSegment[])[] = [
  ...COLUMN_PATHS,
  ['domain', 'namespaces', '*', ['models', 'valueObjects'], '*', 'fields', '*'],
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

interface Rewrite {
  readonly contract: JsonRecord;
  readonly changed: boolean;
  readonly unknownCodecs: readonly string[];
  readonly defaultRewrites: ReadonlyMap<string, Json>;
  readonly integerEnums: ReadonlySet<string>;
  readonly jsonEnums: ReadonlyMap<string, JsonEnumValues>;
  readonly columnCardinalities: ReadonlyMap<string, Json>;
}

/** The rewritten values of an enum typed by `sqlite/json@1`: its value set and its members by name. */
interface JsonEnumValues {
  values: readonly Json[] | undefined;
  readonly members: Map<string, Json>;
}

function rewriteDefault(target: string, codecId: string, value: JsonRecord): JsonRecord {
  const defaultValue = value['default'];
  if (target !== 'sqlite' || !isRecord(defaultValue) || defaultValue['kind'] !== 'literal')
    return value;
  const literal = defaultValue['value'];
  if (literal === undefined) return value;
  if (codecId === SQLITE_JSON_CODEC)
    return { ...value, default: { ...defaultValue, value: canonicalizeJson(literal) } };
  if (
    SQLITE_INTEGER_CODECS.has(codecId) &&
    typeof literal === 'number' &&
    Number.isInteger(literal)
  )
    return { ...value, default: { ...defaultValue, value: BigInt(literal).toString() } };
  return value;
}

function digitText(value: Json): Json {
  return typeof value === 'number' && Number.isInteger(value) ? BigInt(value).toString() : value;
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

/** Release 8.0.0-rc.14 stored a list column or field as `many: true`; the current form is `many: { elementNullable: false }`. */
function currentListForm(entry: JsonRecord): JsonRecord {
  return entry['many'] === true ? { ...entry, many: { elementNullable: false } } : entry;
}

function storageColumnKey(namespaceId: string, table: string, column: string): string {
  return `${namespaceId}\u0000${table}\u0000${column}`;
}

/** The `many` of every storage column, `false` for a column that is not a list. */
function columnCardinalities(contract: JsonRecord): ReadonlyMap<string, Json> {
  const cardinalities = new Map<string, Json>();
  const storage = contract['storage'];
  const namespaces = isRecord(storage) ? storage['namespaces'] : undefined;
  for (const [namespaceId, namespace] of isRecord(namespaces) ? Object.entries(namespaces) : []) {
    if (!isRecord(namespace)) continue;
    const entries = namespace['entries'];
    const tables = isRecord(entries) ? entries['table'] : namespace['tables'];
    for (const [tableName, table] of isRecord(tables) ? Object.entries(tables) : []) {
      const columns = isRecord(table) ? table['columns'] : undefined;
      for (const [columnName, column] of isRecord(columns) ? Object.entries(columns) : [])
        cardinalities.set(
          storageColumnKey(namespaceId, tableName, columnName),
          isRecord(column) ? (column['many'] ?? false) : false,
        );
    }
  }
  return cardinalities;
}

function enumKey(namespaceId: string, name: string): string {
  return `${namespaceId}\u0000${name}`;
}

/**
 * On SQLite the integer codecs store digit text and `sqlite/json@1` stores the JSON text of a
 * document, so the members of an enum typed by one of them, in the domain and in the storage value
 * set its columns name, are rewritten to that text too.
 */
function rewriteSqliteEnums(contract: JsonRecord): {
  readonly contract: JsonRecord;
  readonly integerEnums: ReadonlySet<string>;
  readonly jsonEnums: ReadonlyMap<string, JsonEnumValues>;
} {
  const integerEnums = new Set<string>();
  const jsonEnums = new Map<string, JsonEnumValues>();
  const jsonEnum = (key: string): JsonEnumValues => {
    const existing = jsonEnums.get(key);
    if (existing !== undefined) return existing;
    const created: JsonEnumValues = { values: undefined, members: new Map() };
    jsonEnums.set(key, created);
    return created;
  };
  const domainCodecs = new Map<string, string>();
  const domain = mapRecord(contract['domain'] ?? null, (key, namespaces) =>
    key !== 'namespaces'
      ? namespaces
      : mapRecord(namespaces, (namespaceId, namespace) =>
          mapRecord(namespace, (kind, enums) =>
            kind !== 'enum'
              ? enums
              : mapRecord(enums, (name, enumType) => {
                  const codecId = isRecord(enumType) ? enumType['codecId'] : undefined;
                  if (typeof codecId === 'string')
                    domainCodecs.set(enumKey(namespaceId, name), codecId);
                  const members = isRecord(enumType) ? enumType['members'] : undefined;
                  if (!isRecord(enumType) || typeof codecId !== 'string' || !Array.isArray(members))
                    return enumType;
                  const key = enumKey(namespaceId, name);
                  if (SQLITE_INTEGER_CODECS.has(codecId)) {
                    integerEnums.add(key);
                    return {
                      ...enumType,
                      members: members.map((member) =>
                        isRecord(member) && member['value'] !== undefined
                          ? { ...member, value: digitText(member['value']) }
                          : member,
                      ),
                    };
                  }
                  if (codecId !== SQLITE_JSON_CODEC) return enumType;
                  const rewritten = jsonEnum(key);
                  return {
                    ...enumType,
                    members: members.map((member) => {
                      const value = isRecord(member) ? member['value'] : undefined;
                      if (!isRecord(member) || value === undefined) return member;
                      const text = canonicalizeJson(value);
                      if (typeof member['name'] === 'string')
                        rewritten.members.set(member['name'], text);
                      return { ...member, value: text };
                    }),
                  };
                }),
          ),
        ),
  );

  const columnCodecs = new Map<string, string>();
  const storage = contract['storage'];
  const namespaces = isRecord(storage) ? storage['namespaces'] : undefined;
  for (const namespace of isRecord(namespaces) ? Object.values(namespaces) : []) {
    const entries = isRecord(namespace) ? namespace['entries'] : undefined;
    const tables = isRecord(entries) ? entries['table'] : undefined;
    for (const table of isRecord(tables) ? Object.values(tables) : []) {
      const columns = isRecord(table) ? table['columns'] : undefined;
      for (const column of isRecord(columns) ? Object.values(columns) : []) {
        const valueSet = isRecord(column) ? column['valueSet'] : undefined;
        const codecId = isRecord(column) ? column['codecId'] : undefined;
        if (
          isRecord(valueSet) &&
          typeof valueSet['namespaceId'] === 'string' &&
          typeof valueSet['entityName'] === 'string' &&
          typeof codecId === 'string'
        )
          columnCodecs.set(enumKey(valueSet['namespaceId'], valueSet['entityName']), codecId);
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
                        const key = enumKey(namespaceId, name);
                        const codecId = columnCodecs.get(key) ?? domainCodecs.get(key);
                        const values = isRecord(valueSet) ? valueSet['values'] : undefined;
                        if (codecId === undefined || !isRecord(valueSet) || !Array.isArray(values))
                          return valueSet;
                        if (SQLITE_INTEGER_CODECS.has(codecId)) {
                          integerEnums.add(key);
                          return { ...valueSet, values: values.map(digitText) };
                        }
                        if (codecId !== SQLITE_JSON_CODEC) return valueSet;
                        const texts = values.map(canonicalizeJson);
                        jsonEnum(key).values = texts;
                        return { ...valueSet, values: texts };
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
    integerEnums,
    jsonEnums,
  };
}

function dataTypesFor(
  target: string,
  extra: ReadonlyMap<string, string>,
): Readonly<Record<string, string>> {
  return { ...Object.fromEntries(extra), ...DATA_TYPES[target] };
}

const CODEC_ID = /^[^\s=]+$/;
const DATA_TYPE_ID = /^[a-z0-9]+(?:-[a-z0-9]+)*\/[a-z0-9]+(?:-[a-z0-9]+)*$/;

interface Options {
  readonly root: string;
  readonly dataTypes: ReadonlyMap<string, string>;
  readonly errors: readonly string[];
}

function parseOptions(args: readonly string[]): Options {
  const dataTypes = new Map<string, string>();
  const errors: string[] = [];
  const positional: string[] = [];
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    if (arg !== '--data-type' && !arg.startsWith('--data-type=')) {
      if (arg.startsWith('--')) errors.push(`${arg}: unknown option`);
      else positional.push(arg);
      continue;
    }
    const value = arg === '--data-type' ? (args[++index] ?? '') : arg.slice('--data-type='.length);
    const separator = value.indexOf('=');
    const codecId = value.slice(0, separator);
    const dataType = value.slice(separator + 1);
    if (separator === -1 || !CODEC_ID.test(codecId) || !DATA_TYPE_ID.test(dataType)) {
      errors.push(
        `--data-type ${value}: expected <codec id>=<data type id>, for example acme/shape@1=acme/shape`,
      );
      continue;
    }
    dataTypes.set(codecId, dataType);
  }
  return { root: resolve(positional[0] ?? process.cwd()), dataTypes, errors };
}

function rewriteContract(contract: JsonRecord, extra: ReadonlyMap<string, string>): Rewrite {
  const target = typeof contract['target'] === 'string' ? contract['target'] : '';
  const table = dataTypesFor(target, extra);
  const unknownCodecs = new Set<string>();
  const defaultRewrites = new Map<string, Json>();
  let changed = false;

  const rewriteEntry = (value: JsonRecord, path: readonly string[]): JsonRecord => {
    const codecId = value['codecId'];
    if (typeof codecId !== 'string' || typeof value['nativeType'] !== 'string') return value;
    const dataType = table[codecId];
    if (dataType === undefined) {
      unknownCodecs.add(codecId);
      return value;
    }
    changed = true;
    const { nativeType: _nativeType, ...rest } = value;
    const rewritten = rewriteDefault(target, codecId, { ...rest, dataType });
    const before = value['default'];
    const after = rewritten['default'];
    if (isRecord(before) && isRecord(after) && before['value'] !== after['value']) {
      const columnKey = path.slice(-3);
      const newValue = after['value'];
      if (columnKey[1] === 'columns' && newValue !== undefined)
        defaultRewrites.set(`${columnKey[0]}\u0000${columnKey[2]}`, newValue);
    }
    return rewritten;
  };

  const rewritten = mapContractEntries(contract, NATIVE_TYPE_PATHS, rewriteEntry);
  const extensions = contract['extensions'];
  for (const pack of isRecord(extensions) ? Object.values(extensions) : []) {
    const types = isRecord(pack) ? pack['types'] : undefined;
    const storage = isRecord(types) ? types['storage'] : undefined;
    if (Array.isArray(storage) && storage.some((entry) => isRecord(entry) && 'nativeType' in entry))
      changed = true;
  }
  if (changed && isRecord(extensions)) {
    rewritten['extensions'] = mapRecord(extensions, (_packId, pack) => {
      const types = isRecord(pack) ? pack['types'] : undefined;
      if (!isRecord(pack) || !isRecord(types) || !('storage' in types)) return pack;
      const { storage: _storage, ...rest } = types;
      return { ...pack, types: rest };
    });
  }
  const withLists = changed
    ? mapContractEntries(rewritten, LIST_PATHS, currentListForm)
    : rewritten;
  const enums =
    target === 'sqlite' && changed
      ? rewriteSqliteEnums(withLists)
      : { contract: withLists, integerEnums: new Set<string>(), jsonEnums: new Map() };
  return {
    contract: enums.contract,
    changed,
    unknownCodecs: [...unknownCodecs].sort(compareCodeUnits),
    defaultRewrites,
    integerEnums: enums.integerEnums,
    jsonEnums: enums.jsonEnums,
    columnCardinalities: columnCardinalities(withLists),
  };
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

function holdsNativeType(blocks: readonly Block[], block: Block): boolean {
  return (isColumnBlock(block) || isStorageTypeBlock(blocks, block)) && !isInColumnDefault(block);
}

/** The key of a storage column block, in the `entries.table` and the older `tables` layout. */
function columnBlockKey(block: Block): string | undefined {
  const table = block.parent?.parent;
  const tables = table?.parent;
  const namespace = tables?.label === 'table' ? tables.parent?.parent : tables?.parent;
  if (!isColumnBlock(block) || table === undefined || namespace === undefined) return undefined;
  if (isInColumnDefault(block)) return undefined;
  return storageColumnKey(namespace.label, table.label, block.label);
}

function manyType(many: Json): string {
  return isRecord(many) && typeof many['elementNullable'] === 'boolean'
    ? `{ readonly elementNullable: ${many['elementNullable']} }`
    : 'false';
}

/** Where a member written last in `block` goes, and the text that writes it. */
function lastMember(text: string, block: Block, member: string): { start: number; text: string } {
  const lineStart = text.lastIndexOf('\n', block.end - 1) + 1;
  const closingIndent = text.slice(lineStart, block.end);
  if (closingIndent.trim() === '')
    return { start: lineStart, text: `${closingIndent}  ${member};\n` };
  const contentEnd = block.start + 1 + text.slice(block.start + 1, block.end).trimEnd().length;
  return {
    start: contentEnd,
    text: text[contentEnd - 1] === ';' ? ` ${member};` : `; ${member}`,
  };
}

function prettierString(value: string): string {
  const singles = (value.match(/'/g) ?? []).length;
  const doubles = (value.match(/"/g) ?? []).length;
  const quote = singles > doubles ? '"' : "'";
  const escaped = JSON.stringify(value)
    .slice(1, -1)
    .replaceAll(String.fromCharCode(0x2028), '\\u2028')
    .replaceAll(String.fromCharCode(0x2029), '\\u2029')
    .replace(
      /\\(.)|(["'])/gs,
      (match: string, escapedChar: string | undefined, bare: string | undefined) => {
        if (bare !== undefined) return bare === quote ? `\\${bare}` : bare;
        if (escapedChar === quote) return match;
        if (escapedChar === '"' || escapedChar === "'") return escapedChar;
        return match;
      },
    );
  return `${quote}${escaped}${quote}`;
}

function typeLiteral(value: Json): string {
  return typeof value === 'string' ? prettierString(value) : JSON.stringify(value);
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

function statementRemoval(
  text: string,
  start: number,
  end: number,
): { start: number; end: number; text: string } {
  const after = /^;?[ \t]*/.exec(text.slice(end))?.[0].length ?? 0;
  const lineStart = text.lastIndexOf('\n', start - 1) + 1;
  const ownsLines = text.slice(lineStart, start).trim() === '' && text[end + after] === '\n';
  return ownsLines
    ? { start: lineStart, end: end + after + 1, text: '' }
    : { start, end: end + after, text: '' };
}

function quoteIntegers(text: string): string {
  return text.replace(/(?<![\w'".-])-?\d+(?![\w'".])/g, (digits: string) => `'${BigInt(digits)}'`);
}

function rewriteDts(
  text: string,
  target: string,
  extra: ReadonlyMap<string, string>,
  defaultRewrites: ReadonlyMap<string, Json>,
  integerEnums: ReadonlySet<string>,
  jsonEnums: ReadonlyMap<string, JsonEnumValues>,
  columnCardinalities: ReadonlyMap<string, Json>,
  hashes: ReadonlyMap<string, string>,
): string {
  const table = dataTypesFor(target, extra);
  const blocks = scanBlocks(text);
  const edits: { start: number; end: number; text: string }[] = [];

  for (const match of text.matchAll(/readonly storage: readonly \[/g)) {
    const types = innermostBlock(blocks, match.index);
    if (types?.label !== 'types' || types.parent?.parent?.label !== 'extensions') continue;
    const end = bracketEnd(text, match.index + match[0].length - 1);
    edits.push(statementRemoval(text, match.index, end));
  }

  for (const match of text.matchAll(/readonly nativeType: (['"])(?:\\.|(?!\1).)*\1/g)) {
    const block = innermostBlock(blocks, match.index);
    if (block === undefined || !holdsNativeType(blocks, block)) continue;
    const codecId = memberOf(text, blocks, block, 'codecId');
    const dataType = codecId === undefined ? undefined : table[codecId];
    if (dataType === undefined) continue;
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      text: `readonly dataType: ${prettierString(dataType)}`,
    });
  }

  const listMembers = new Set<Block>();
  for (const match of text.matchAll(/readonly many: (true|false|\{)/g)) {
    const block = innermostBlock(blocks, match.index);
    if (block === undefined) continue;
    listMembers.add(block);
    if (match[1] !== 'true') continue;
    const key = columnBlockKey(block);
    const many = key === undefined ? undefined : columnCardinalities.get(key);
    if (many === undefined && block.parent?.label !== 'fields') continue;
    edits.push({
      start: match.index,
      end: match.index + match[0].length,
      text: `readonly many: ${manyType(many ?? { elementNullable: false })}`,
    });
  }
  for (const block of blocks) {
    const key = columnBlockKey(block);
    const many = key === undefined ? undefined : columnCardinalities.get(key);
    if (many === undefined || listMembers.has(block)) continue;
    const member = lastMember(text, block, `readonly many: ${manyType(many)}`);
    edits.push({ start: member.start, end: member.start, text: member.text });
  }

  for (const match of text.matchAll(/DefaultLiteralValue<\s*(['"])(?:\\.|(?!\1).)*\1\s*,\s*/g)) {
    const argumentStart = match.index + match[0].length;
    const defaultBlock = innermostBlock(blocks, match.index);
    const column = defaultBlock?.parent;
    const tableBlock = column?.parent?.parent;
    if (column === undefined || tableBlock === undefined || column.parent?.label !== 'columns')
      continue;
    const value = defaultRewrites.get(`${tableBlock.label}\u0000${column.label}`);
    if (value === undefined) continue;
    const argumentEnd = genericArgumentEnd(text, argumentStart);
    const trimmedEnd = argumentStart + text.slice(argumentStart, argumentEnd).trimEnd().length;
    edits.push({ start: argumentStart, end: trimmedEnd, text: typeLiteral(value) });
  }

  for (const match of text.matchAll(/readonly values: readonly \[([^\]]*)\]/g)) {
    const valueSet = innermostBlock(blocks, match.index);
    const kind = valueSet?.parent;
    const namespace = kind?.parent?.parent;
    if (
      valueSet === undefined ||
      kind?.label !== 'valueSet' ||
      kind.parent?.label !== 'entries' ||
      namespace === undefined ||
      !integerEnums.has(enumKey(namespace.label, valueSet.label))
    )
      continue;
    const values = match[1] ?? '';
    const start = match.index + match[0].length - values.length - 1;
    edits.push({ start, end: start + values.length, text: quoteIntegers(values) });
  }

  for (const match of text.matchAll(/readonly value: (-?\d+)(?=\s*[;},])/g)) {
    const member = innermostBlock(blocks, match.index);
    const enumType = member?.parent;
    const namespace = enumType?.parent?.parent;
    const digits = match[1] ?? '';
    if (
      member === undefined ||
      member.label !== '' ||
      enumType?.parent?.label !== 'enum' ||
      namespace === undefined ||
      !integerEnums.has(enumKey(namespace.label, enumType.label))
    )
      continue;
    const start = match.index + match[0].length - digits.length;
    edits.push({ start, end: start + digits.length, text: quoteIntegers(digits) });
  }

  for (const match of text.matchAll(/readonly values: readonly \[/g)) {
    const valueSet = innermostBlock(blocks, match.index);
    const kind = valueSet?.parent;
    const namespace = kind?.parent?.parent;
    if (
      valueSet === undefined ||
      kind?.label !== 'valueSet' ||
      kind.parent?.label !== 'entries' ||
      namespace === undefined
    )
      continue;
    const values = jsonEnums.get(enumKey(namespace.label, valueSet.label))?.values;
    if (values === undefined) continue;
    const open = match.index + match[0].length - 1;
    edits.push({
      start: open + 1,
      end: bracketEnd(text, open) - 1,
      text: values.map(typeLiteral).join(', '),
    });
  }

  for (const match of text.matchAll(/readonly value: /g)) {
    const member = innermostBlock(blocks, match.index);
    const enumType = member?.parent;
    const namespace = enumType?.parent?.parent;
    if (
      member === undefined ||
      member.label !== '' ||
      enumType?.parent?.label !== 'enum' ||
      namespace === undefined
    )
      continue;
    const name = memberOf(text, blocks, member, 'name');
    const value =
      name === undefined
        ? undefined
        : jsonEnums.get(enumKey(namespace.label, enumType.label))?.members.get(name);
    if (value === undefined) continue;
    const start = match.index + match[0].length;
    const end = start + text.slice(start, literalEnd(text, start)).trimEnd().length;
    edits.push({ start, end, text: typeLiteral(value) });
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

function replaceQuotedHashes(text: string, hashes: ReadonlyMap<string, string>): string {
  return text.replace(/"([0-9a-f]{64})"/g, (match: string, hash: string) => {
    const next = hashes.get(hash);
    return next === undefined ? match : `"${next}"`;
  });
}

interface ContractPlan {
  readonly path: string;
  readonly snapshot: boolean;
  readonly oldHash: string;
  readonly newHash: string;
  readonly content: string;
  readonly target: string;
  readonly defaultRewrites: ReadonlyMap<string, Json>;
  readonly integerEnums: ReadonlySet<string>;
  readonly jsonEnums: ReadonlyMap<string, JsonEnumValues>;
  readonly columnCardinalities: ReadonlyMap<string, Json>;
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
  if (contractsFound === 0) return [`No SQL contract was found under ${root}; nothing changed.`];
  if (files === 0 && directories === 0)
    return ['The project is already in the new format; nothing changed.'];
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

function main({ root, dataTypes, errors }: Options): number {
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
      typeof contract['target'] !== 'string'
    )
      continue;
    const storage = contract['storage'];
    if (!isRecord(storage)) continue;
    contractsFound++;
    const snapshot = isSnapshotContract(path);
    const stored = storage['storageHash'];
    const oldHash = snapshot ? basename(dirname(path)) : typeof stored === 'string' ? stored : '';
    const recomputes = computeStorageHash(contract) === oldHash;
    const rewrite = rewriteContract(contract, dataTypes);
    for (const codecId of rewrite.unknownCodecs)
      stops.push(
        `${display(path)}: unknown codec ${codecId}; name its data type with --data-type ${codecId}=<data type id>`,
      );
    if (!rewrite.changed) continue;
    if (!recomputes)
      notices.push(`${display(path)}: stored hash did not recompute; rehashed from content`);
    const newHash = computeStorageHash(rewrite.contract);
    const contractWithHash = withStorageHash(rewrite.contract, newHash);
    plans.push({
      path,
      snapshot,
      oldHash,
      newHash,
      content: snapshot ? snapshotForm(contractWithHash) : emittedForm(contractWithHash, text),
      target: contract['target'],
      defaultRewrites: rewrite.defaultRewrites,
      integerEnums: rewrite.integerEnums,
      jsonEnums: rewrite.jsonEnums,
      columnCardinalities: rewrite.columnCardinalities,
    });
  }

  for (const target of [...new Set(plans.map((plan) => plan.target))].sort(compareCodeUnits)) {
    for (const [codecId, dataType] of dataTypes) {
      const known = DATA_TYPES[target]?.[codecId];
      if (known !== undefined)
        stops.push(
          `--data-type ${codecId}=${dataType}: the script already maps ${codecId} to ${known} on target ${target}`,
        );
    }
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
      ? rewriteDts(
          readFileSync(dtsPath, 'utf8'),
          plan.target,
          dataTypes,
          plan.defaultRewrites,
          plan.integerEnums,
          plan.jsonEnums,
          plan.columnCardinalities,
          dtsHashes,
        )
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

process.exitCode = main(parseOptions(process.argv.slice(2)));
