#!/usr/bin/env node
/**
 * Removes the `noCheck` key from every column of every SQL contract in a project. Where the key waived the element check of a list, the column and the field that maps it become lists whose elements may be null, in `contract.json` and `contract.d.ts`, because that is what the database enforces. The checks each contract declares are left as they are. In a PostgreSQL contract it also writes each literal default in the contract form this release stores, as its column's data type and parameters give it. The script then renames the snapshot directories and rewrites every migration, ref, `migration.ts` and `contract.d.ts` that names an old storage hash.
 *
 * Usage: node remove-nocheck.ts [project-root] [--default <namespace>.<table>.<column>=<JSON value>]...
 *
 * The project root defaults to the working directory. The script reads and writes files only. It needs no database, network or configured stack, and a project already in this release's form is left unchanged. When it stops (a file it must read is not valid JSON, a contract whose stored hash does not match its content, a default that this release refuses, or a snapshot directory that already exists with different content) it changes no file, prints one line per case and exits 1. When it finishes it prints how many files and snapshot directories it changed and each storage hash it replaced.
 *
 * `--default` gives the value to store in place of a default this release refuses, in every stored contract where that column's default is refused. The script checks the value by the same rules, and stops when a `--default` names a column whose default it does not refuse.
 *
 * The storage hash and migration hash rules are copied from `@internal/contract` and `@internal/migration-tools`, and the default rules from the data types of 8.0.0-rc.19, PostgreSQL's built-in types, `postgis/geometry` and `pgvector/vector`, so the script gives the same result whatever is installed.
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
  readonly defaults: ReadonlyMap<string, readonly DefaultRewrite[]>;
  readonly notValues: readonly string[];
}

interface DefaultRewrite {
  readonly from: string | number;
  readonly to: string | number;
}

type DefaultForm =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rewritten'; readonly value: Json }
  | { readonly kind: 'notAValue'; readonly reason: string };

type Params = Readonly<Record<string, Json>>;

class NotAValue extends Error {}

class CastRefused extends Error {}

function refuseJsonValue(typeId: string, expected: string): never {
  throw new NotAValue(`${typeId} JSON value must be ${expected}`);
}

function withoutTrailing(text: string, character: string): string {
  let end = text.length;
  while (end > 0 && text[end - 1] === character) end -= 1;
  return end === text.length ? text : text.slice(0, end);
}

function counted(amount: number, noun: string): string {
  return `${amount} ${amount === 1 ? noun : `${noun}s`}`;
}

function integerParam(params: Params, name: string): number | undefined {
  const value = params[name];
  return typeof value === 'number' ? value : undefined;
}

function readJsonString(typeId: string, json: Json): string {
  return typeof json === 'string' ? json : refuseJsonValue(typeId, 'a string');
}

function readJsonMatching(typeId: string, json: Json, pattern: RegExp, form: string): string {
  return typeof json === 'string' && pattern.test(json) ? json : refuseJsonValue(typeId, form);
}

function readJsonInteger(typeId: string, json: Json, min: number, max: number): Json {
  return typeof json === 'number' && Number.isInteger(json) && json >= min && json <= max
    ? json
    : refuseJsonValue(typeId, `an integer from ${min} to ${max}`);
}

const INT64_MIN = -(2n ** 63n);
const INT64_MAX = 2n ** 63n - 1n;

function readInt8(json: Json): Json {
  const expected = `a decimal integer string from ${INT64_MIN} to ${INT64_MAX}`;
  const value = BigInt(readJsonMatching('pg/int8', json, /^-?\d+$/, expected));
  if (value < INT64_MIN || value > INT64_MAX) return refuseJsonValue('pg/int8', expected);
  const written = value.toString();
  if (json !== written)
    return refuseJsonValue(
      'pg/int8',
      `"${written}", the integer's decimal text without leading zeros or a minus sign on zero`,
    );
  return json;
}

const NON_FINITE_TEXT: ReadonlySet<string> = new Set(['NaN', 'Infinity', '-Infinity']);

function readJsonFloat(typeId: string, json: Json): number {
  if (typeof json === 'number' && Number.isFinite(json)) return json;
  if (typeof json === 'string' && NON_FINITE_TEXT.has(json)) return Number(json);
  return refuseJsonValue(typeId, 'a finite number or the text NaN, Infinity or -Infinity');
}

const FLOAT4_MAX = 3.4028234663852886e38;

function fitsFloat4(value: number): boolean {
  const single = Math.fround(value);
  return Number.isFinite(single) && (value === 0 || single !== 0);
}

function readFloat4(json: Json): Json {
  const value = readJsonFloat('pg/float4', json);
  if (Number.isFinite(value) && !fitsFloat4(value))
    return refuseJsonValue(
      'pg/float4',
      `a number float4 holds, at most ${FLOAT4_MAX} in magnitude and not so small that it becomes 0, or the text NaN, Infinity or -Infinity`,
    );
  return json;
}

const DECIMAL_NUMERAL_TEXT = /^-?\d+(?:\.\d+)?$/;
const STORED_NUMERIC_TEXT = /^(?:(?!-0(?:\.0+)?$)-?(?:0|[1-9]\d*)(?:\.\d+)?|NaN|-?Infinity)$/;

function storedNumeralText(text: string): string {
  const numeral = /^([+-]?)0*(\d+)(\.\d+)?$/.exec(text);
  if (numeral === null) return text;
  const [, sign = '', whole = '', fraction = ''] = numeral;
  const digits = `${whole}${fraction}`;
  return sign !== '-' || /^[0.]+$/.test(digits) ? digits : `-${digits}`;
}

function fitsNumeric(text: string, precision: number, scale: number): boolean {
  if (text === 'NaN') return true;
  if (text.endsWith('Infinity')) return false;
  const [whole = '', fraction = ''] = text.replace(/^-/, '').split('.');
  const significantFraction = withoutTrailing(fraction, '0');
  const digits = `${whole}${significantFraction}`.replace(/^0+/, '');
  if (digits === '') return true;
  const shift = scale - significantFraction.length;
  if (shift >= 0) return digits.length + shift <= precision;
  const units = withoutTrailing(digits, '0');
  const droppedZeros = digits.length - units.length;
  if (droppedZeros < -shift) return false;
  return digits.length + shift <= precision;
}

function readNumeric(json: Json, params: Params): Json {
  if (typeof json !== 'string' || !STORED_NUMERIC_TEXT.test(json)) {
    const printed =
      typeof json === 'string' && DECIMAL_NUMERAL_TEXT.test(json)
        ? storedNumeralText(json)
        : undefined;
    return refuseJsonValue(
      'pg/numeric',
      printed === undefined ? 'a decimal string' : `"${printed}", as PostgreSQL writes this value`,
    );
  }
  const precision = integerParam(params, 'precision');
  if (precision === undefined) return json;
  const scale = integerParam(params, 'scale') ?? 0;
  if (!fitsNumeric(json, precision, scale))
    return refuseJsonValue(
      'pg/numeric',
      `a decimal string that numeric(${precision}, ${scale}) stores without rounding`,
    );
  return json;
}

function spellNumeric(json: Json, params: Params): Json {
  const precision = integerParam(params, 'precision');
  if (precision === undefined || typeof json !== 'string' || json === 'NaN') return json;
  const scale = integerParam(params, 'scale') ?? 0;
  const [whole = '', fraction = ''] = json.split('.');
  return scale <= 0 ? whole : `${whole}.${fraction.slice(0, scale).padEnd(scale, '0')}`;
}

function fitsCharacterLength(text: string, length: number, blankPadded: boolean): boolean {
  const significant = blankPadded ? withoutTrailing(text, ' ') : text;
  return significant.length <= length || [...significant].length <= length;
}

function readCharacter(json: Json, params: Params): Json {
  const length = integerParam(params, 'length') ?? 1;
  if (!fitsCharacterLength(readJsonString('pg/char', json), length, true))
    return refuseJsonValue(
      'pg/char',
      `a string of at most ${counted(length, 'character')} before any trailing spaces`,
    );
  return json;
}

function spellCharacter(json: Json): Json {
  return typeof json === 'string' ? withoutTrailing(json, ' ') : json;
}

function readCharacterVarying(json: Json, params: Params): Json {
  const length = integerParam(params, 'length');
  const text = readJsonString('pg/varchar', json);
  if (length !== undefined && !fitsCharacterLength(text, length, false))
    return refuseJsonValue('pg/varchar', `a string of at most ${counted(length, 'character')}`);
  return json;
}

const BIT_STRING = /^[01]*$/;

function readBit(json: Json, params: Params): Json {
  const length = integerParam(params, 'length') ?? 1;
  const bits = readJsonMatching('pg/bit', json, BIT_STRING, 'a string of 0 and 1 digits');
  if (bits.length !== length)
    return refuseJsonValue('pg/bit', `a string of exactly ${counted(length, 'bit')}`);
  return json;
}

function readBitVarying(json: Json, params: Params): Json {
  const length = integerParam(params, 'length');
  const bits = readJsonMatching('pg/varbit', json, BIT_STRING, 'a string of 0 and 1 digits');
  if (length !== undefined && bits.length > length)
    return refuseJsonValue('pg/varbit', `a string of at most ${counted(length, 'bit')}`);
  return json;
}

function readTextArray(json: Json): Json {
  const expected = 'an array of strings and nulls';
  if (!Array.isArray(json)) return refuseJsonValue('pg/text-array', expected);
  for (const entry of json)
    if (entry !== null && typeof entry !== 'string')
      return refuseJsonValue('pg/text-array', expected);
  return json;
}

const UUID_INPUT = /^(?:\{[0-9a-f]{4}(?:-?[0-9a-f]{4}){7}\}|[0-9a-f]{4}(?:-?[0-9a-f]{4}){7})$/i;

function storedUuid(text: string): string | undefined {
  if (!UUID_INPUT.test(text)) return undefined;
  const hex = text.replace(/[{}-]/g, '').toLowerCase();
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}

interface InetValue {
  readonly bytes: readonly number[];
  readonly bits: number;
}

const isDigit = (ch: string | undefined): ch is string => ch !== undefined && /^[0-9]$/.test(ch);

function storedInet(text: string): string | undefined {
  if (text.includes(':')) {
    const value = readIpv6(text);
    return value === undefined ? undefined : printIpv6(value);
  }
  const value = readIpv4(text);
  return value === undefined ? undefined : printIpv4(value);
}

function readIpv4(text: string): InetValue | undefined {
  const octets: number[] = [];
  let index = 0;
  let ch = text[index++];
  while (isDigit(ch)) {
    let octet = 0;
    do {
      octet = octet * 10 + Number(ch);
      if (octet > 255) return undefined;
      ch = text[index++];
    } while (isDigit(ch));
    if (octets.length === 4) return undefined;
    octets.push(octet);
    if (ch === undefined || ch === '/') break;
    if (ch !== '.') return undefined;
    ch = text[index++];
  }
  let bits = -1;
  if (ch === '/' && isDigit(text[index]) && octets.length > 0) {
    ch = text[index++];
    bits = 0;
    do {
      bits = bits * 10 + Number(ch);
      ch = text[index++];
    } while (isDigit(ch));
    if (ch !== undefined || bits > 32) return undefined;
  }
  if (ch !== undefined) return undefined;
  if (bits === -1) {
    if (octets.length !== 4) return undefined;
    bits = 32;
  }
  if (octets.length === 0 || Math.floor(bits / 8) > octets.length) return undefined;
  return { bytes: [...octets, 0, 0, 0, 0].slice(0, 4), bits };
}

function readBits(text: string): number | undefined {
  let bits = 0;
  let digits = 0;
  for (const ch of text) {
    if (!isDigit(ch)) return undefined;
    if (digits++ !== 0 && bits === 0) return undefined;
    bits = bits * 10 + Number(ch);
    if (bits > 128) return undefined;
  }
  return digits === 0 ? undefined : bits;
}

function readIpv4Tail(
  text: string,
): { readonly octets: readonly number[]; readonly bits: number | undefined } | undefined {
  const octets: number[] = [];
  let octet = 0;
  let digits = 0;
  for (const [index, ch] of [...text].entries()) {
    if (isDigit(ch)) {
      if (digits++ !== 0 && octet === 0) return undefined;
      octet = octet * 10 + Number(ch);
      if (octet > 255) return undefined;
      continue;
    }
    if (ch !== '.' && ch !== '/') return undefined;
    if (octets.length > 3) return undefined;
    octets.push(octet);
    if (ch === '/') {
      const bits = readBits(text.slice(index + 1));
      return bits === undefined ? undefined : { octets, bits };
    }
    octet = 0;
    digits = 0;
  }
  if (digits === 0 || octets.length > 3) return undefined;
  return { octets: [...octets, octet], bits: undefined };
}

function readIpv6(text: string): InetValue | undefined {
  const bytes = new Array<number>(16).fill(0);
  let filled = 0;
  let compressedAt: number | undefined;
  let index = 0;
  if (text[0] === ':') {
    if (text[1] !== ':') return undefined;
    index = 1;
  }
  let tokenStart = index;
  let sawHexDigit = false;
  let group = 0;
  let groupDigits = 0;
  let bits = 128;
  while (index < text.length) {
    const ch = text[index++] ?? '';
    if (/^[0-9a-fA-F]$/.test(ch)) {
      group = (group << 4) | Number.parseInt(ch, 16);
      if (++groupDigits > 4) return undefined;
      sawHexDigit = true;
      continue;
    }
    if (ch === ':') {
      tokenStart = index;
      if (!sawHexDigit) {
        if (compressedAt !== undefined) return undefined;
        compressedAt = filled;
        continue;
      }
      if (index >= text.length || filled + 2 > 16) return undefined;
      bytes[filled++] = group >> 8;
      bytes[filled++] = group & 0xff;
      sawHexDigit = false;
      group = 0;
      groupDigits = 0;
      continue;
    }
    if (ch === '.' && filled + 4 <= 16) {
      const tail = readIpv4Tail(text.slice(tokenStart));
      if (tail !== undefined) {
        tail.octets.forEach((octet, offset) => {
          bytes[filled + offset] = octet;
        });
        filled += 4;
        sawHexDigit = false;
        bits = tail.bits ?? bits;
        break;
      }
    }
    if (ch === '/') {
      const prefix = readBits(text.slice(index));
      if (prefix !== undefined) {
        bits = prefix;
        break;
      }
    }
    return undefined;
  }
  if (sawHexDigit) {
    if (filled + 2 > 16) return undefined;
    bytes[filled++] = group >> 8;
    bytes[filled++] = group & 0xff;
  }
  if (compressedAt !== undefined) {
    if (filled === 16) return undefined;
    const shifted = bytes.slice(compressedAt, filled);
    bytes.fill(0, compressedAt, filled);
    bytes.splice(16 - shifted.length, shifted.length, ...shifted);
    filled = 16;
  }
  return filled === 16 ? { bytes, bits } : undefined;
}

function printIpv4({ bytes, bits }: InetValue): string {
  const address = bytes.join('.');
  return bits === 32 ? address : `${address}/${bits}`;
}

function printIpv6({ bytes, bits }: InetValue): string {
  const groups = Array.from(
    { length: 8 },
    (_, i) => ((bytes[2 * i] ?? 0) << 8) | (bytes[2 * i + 1] ?? 0),
  );
  const zeroRun = longestZeroRun(groups);
  let text = '';
  for (let i = 0; i < 8; i++) {
    if (zeroRun !== undefined && i >= zeroRun.start && i < zeroRun.start + zeroRun.length) {
      if (i === zeroRun.start) text += ':';
      continue;
    }
    if (i !== 0) text += ':';
    const ipv4Tail =
      i === 6 &&
      zeroRun?.start === 0 &&
      (zeroRun.length === 6 || (zeroRun.length === 5 && groups[5] === 0xffff));
    if (ipv4Tail) {
      text += bytes.slice(12).join('.');
      break;
    }
    text += (groups[i] ?? 0).toString(16);
  }
  if (zeroRun !== undefined && zeroRun.start + zeroRun.length === 8) text += ':';
  return bits === 128 ? text : `${text}/${bits}`;
}

function longestZeroRun(
  groups: readonly number[],
): { readonly start: number; readonly length: number } | undefined {
  let best: { start: number; length: number } | undefined;
  let current: { start: number; length: number } | undefined;
  for (const [i, group] of groups.entries()) {
    if (group === 0) {
      current =
        current === undefined
          ? { start: i, length: 1 }
          : { ...current, length: current.length + 1 };
      continue;
    }
    if (current !== undefined && (best === undefined || current.length > best.length))
      best = current;
    current = undefined;
  }
  if (current !== undefined && (best === undefined || current.length > best.length)) best = current;
  return best !== undefined && best.length >= 2 ? best : undefined;
}

const BASE64_TEXT = /^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/;

function spellBytea(json: Json): Json {
  return typeof json === 'string' ? Buffer.from(json, 'base64').toString('base64') : json;
}

const ISO_DURATION =
  /^P(?!$)(-?\d+Y)?(-?\d+M)?(-?\d+D)?(?:T(?!$)(-?\d+H)?(-?\d+M)?(-?\d+(?:\.\d+)?S)?)?$/;
const MICROS_PER_SECOND = 1_000_000n;

interface IntervalFields {
  readonly months: number;
  readonly days: number;
  readonly micros: bigint;
}

function microsFromFraction(fraction: string, negative: boolean): bigint {
  if (fraction === '') return 0n;
  const kept = BigInt(fraction.slice(0, 6).padEnd(6, '0'));
  const rest = fraction.slice(6).replace(/0+$/, '');
  if (rest === '') return kept;
  const half = rest[0] === '5' && rest.length === 1;
  const roundsUp = rest > '5' || (half && !negative);
  return roundsUp ? kept + 1n : kept;
}

function intervalFieldsOf(match: RegExpExecArray): IntervalFields {
  const [, years, months, days, hours, minutes, seconds] = match;
  const wholeNumber = (part: string | undefined): number =>
    part === undefined ? 0 : Number(part.slice(0, -1));
  const secondsLiteral = seconds === undefined ? '0' : seconds.slice(0, -1);
  const negative = secondsLiteral.startsWith('-');
  const [whole = '0', fraction = ''] = secondsLiteral.replace('-', '').split('.');
  const magnitude = BigInt(whole) * MICROS_PER_SECOND + microsFromFraction(fraction, negative);
  return {
    months: wholeNumber(years) * 12 + wholeNumber(months),
    days: wholeNumber(days),
    micros:
      BigInt(wholeNumber(hours)) * 3_600n * MICROS_PER_SECOND +
      BigInt(wholeNumber(minutes)) * 60n * MICROS_PER_SECOND +
      (negative ? -magnitude : magnitude),
  };
}

function secondsText(micros: bigint): string {
  const sign = micros < 0n ? '-' : '';
  const magnitude = micros < 0n ? -micros : micros;
  const whole = (magnitude / MICROS_PER_SECOND) % 60n;
  const fraction = magnitude % MICROS_PER_SECOND;
  const fractionText =
    fraction === 0n ? '' : `.${fraction.toString().padStart(6, '0').replace(/0+$/, '')}`;
  return `${sign}${whole}${fractionText}`;
}

function formatIsoDuration({ months, days, micros }: IntervalFields): string {
  const years = Math.trunc(months / 12);
  const restMonths = months % 12;
  const sign = micros < 0n ? '-' : '';
  const magnitude = micros < 0n ? -micros : micros;
  const hours = magnitude / (3_600n * MICROS_PER_SECOND);
  const minutes = (magnitude / (60n * MICROS_PER_SECOND)) % 60n;
  const hasSeconds = magnitude % (60n * MICROS_PER_SECOND) !== 0n;
  const parts = [
    years === 0 ? '' : `${years}Y`,
    restMonths === 0 ? '' : `${restMonths}M`,
    days === 0 ? '' : `${days}D`,
  ];
  const time = [
    hours === 0n ? '' : `${sign}${hours}H`,
    minutes === 0n ? '' : `${sign}${minutes}M`,
    hasSeconds ? `${secondsText(micros)}S` : '',
  ].join('');
  const rendered = `P${parts.join('')}${time === '' ? '' : `T${time}`}`;
  return rendered === 'P' ? 'PT0S' : rendered;
}

const POSTGRES_INTERVAL =
  /^(?:([+-]?\d+) years? ?)?(?:([+-]?\d+) mons? ?)?(?:([+-]?\d+) days? ?)?(?:([+-])?(\d+):(\d{2}):(\d{2})(?:\.(\d+))?)?$/;

function postgresIntervalFields(text: string): IntervalFields | undefined {
  const match = POSTGRES_INTERVAL.exec(text);
  if (match === null || text === '' || text.endsWith(' ')) return undefined;
  const [, years = '0', months = '0', days = '0', sign, hours = '0', minutes = '0', seconds = '0'] =
    match;
  const fraction = match[8] ?? '';
  const magnitude =
    (BigInt(hours) * 3_600n + BigInt(minutes) * 60n + BigInt(seconds)) * MICROS_PER_SECOND +
    microsFromFraction(fraction, sign === '-');
  return {
    months: Number(years) * 12 + Number(months),
    days: Number(days),
    micros: sign === '-' ? -magnitude : magnitude,
  };
}

function intervalStoredText(text: string): string {
  const fractionDigits = /\.(\d+)/.exec(text)?.[1]?.length ?? 0;
  if (fractionDigits > 6)
    throw new CastRefused(
      `"${text}" has ${fractionDigits} digits after the decimal point, but pg/interval holds microseconds, so at most 6. Round it, as in "PT1.123456S".`,
    );
  const iso = ISO_DURATION.exec(text);
  if (iso !== null) return formatIsoDuration(intervalFieldsOf(iso));
  const fields = postgresIntervalFields(text);
  if (fields === undefined)
    throw new CastRefused(
      `pg/interval cannot read "${text}". Write an ISO 8601 duration, as in "P1Y2M3DT4H5M6S".`,
    );
  return formatIsoDuration(fields);
}

function isoYearText(text: string): string {
  const match = /^(\d{4,6})(-.*?)( BC)?$/.exec(text);
  if (match === null) return text;
  const [, digits = '', rest = '', bc] = match;
  const year = Number(digits);
  if (bc !== undefined) {
    if (year === 0) return text;
    return `${yearText(1 - year)}${rest}`;
  }
  return digits.length > 4 ? `${yearText(year)}${rest}` : text;
}

type DateTimeShape = 'date' | 'time' | 'timeWithOffset' | 'dateTime' | 'instant';

interface DateTimeOptions {
  readonly shape: DateTimeShape;
  readonly typeId: string;
  readonly maxOffsetHours?: number;
  readonly range?: { readonly earliest: string; readonly latest: string };
}

interface DateFields {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface TimeFields {
  readonly hour: number;
  readonly minute: number;
  readonly second: number;
  readonly fraction: string;
}

interface WrittenDateTime {
  readonly date: DateFields | undefined;
  readonly time: TimeFields | undefined;
  readonly offsetSeconds: number | undefined;
  readonly fractionDigits: number;
}

const SHAPES: Readonly<
  Record<
    DateTimeShape,
    {
      readonly description: string;
      readonly plural: string;
      readonly example: string;
      readonly date: boolean;
      readonly time: boolean;
      readonly offset: boolean;
    }
  >
> = {
  date: {
    description: 'a date',
    plural: 'dates',
    example: '2024-01-01',
    date: true,
    time: false,
    offset: false,
  },
  time: {
    description: 'a time of day',
    plural: 'times of day',
    example: '12:34:56',
    date: false,
    time: true,
    offset: false,
  },
  timeWithOffset: {
    description: 'a time of day with a UTC offset',
    plural: 'times of day with a UTC offset',
    example: '12:34:56+02:00',
    date: false,
    time: true,
    offset: true,
  },
  dateTime: {
    description: 'a date and time',
    plural: 'dates and times',
    example: '2024-01-01T12:34:56',
    date: true,
    time: true,
    offset: false,
  },
  instant: {
    description: 'a date and time with a UTC offset',
    plural: 'instants',
    example: '2024-01-01T12:34:56Z',
    date: true,
    time: true,
    offset: true,
  },
};

const DATE_PREFIX = /^([+-]\d{6}|\d{4})-(\d{2})-(\d{2})/;
const TIME_PREFIX = /^(\d{2}):(\d{2})(?::(\d{2})(?:\.(\d+))?)?/;
const OFFSET = /^([+-])(\d{2})(?::(\d{2})(?::(\d{2}))?)?$/;
const MAX_FRACTION_DIGITS = 6;
const SECONDS_PER_DAY = 86_400;
const MIDNIGHT: TimeFields = { hour: 0, minute: 0, second: 0, fraction: '' };

function isLeapYear(year: number): boolean {
  return (year % 4 === 0 && year % 100 !== 0) || year % 400 === 0;
}

function daysInMonth(year: number, month: number): number {
  if (month === 2) return isLeapYear(year) ? 29 : 28;
  return [4, 6, 9, 11].includes(month) ? 30 : 31;
}

function daysFromCivil({ year, month, day }: DateFields): number {
  const shifted = month <= 2 ? year - 1 : year;
  const era = Math.floor(shifted / 400);
  const yearOfEra = shifted - era * 400;
  const dayOfYear = Math.floor((153 * (month + (month > 2 ? -3 : 9)) + 2) / 5) + day - 1;
  const dayOfEra =
    yearOfEra * 365 + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100) + dayOfYear;
  return era * 146_097 + dayOfEra - 719_468;
}

function civilFromDays(days: number): DateFields {
  const shifted = days + 719_468;
  const era = Math.floor(shifted / 146_097);
  const dayOfEra = shifted - era * 146_097;
  const yearOfEra = Math.floor(
    (dayOfEra -
      Math.floor(dayOfEra / 1460) +
      Math.floor(dayOfEra / 36_524) -
      Math.floor(dayOfEra / 146_096)) /
      365,
  );
  const dayOfYear =
    dayOfEra - (365 * yearOfEra + Math.floor(yearOfEra / 4) - Math.floor(yearOfEra / 100));
  const monthIndex = Math.floor((5 * dayOfYear + 2) / 153);
  const day = dayOfYear - Math.floor((153 * monthIndex + 2) / 5) + 1;
  const month = monthIndex < 10 ? monthIndex + 3 : monthIndex - 9;
  return { year: yearOfEra + era * 400 + (month <= 2 ? 1 : 0), month, day };
}

function pad(value: number, width = 2): string {
  return String(value).padStart(width, '0');
}

function yearText(year: number): string {
  if (year >= 0 && year <= 9999) return pad(year, 4);
  return `${year < 0 ? '-' : '+'}${pad(Math.abs(year), 6)}`;
}

function dateText(date: DateFields): string {
  return `${yearText(date.year)}-${pad(date.month)}-${pad(date.day)}`;
}

function timeText(time: TimeFields): string {
  const fraction = time.fraction.replace(/0+$/, '');
  return `${pad(time.hour)}:${pad(time.minute)}:${pad(time.second)}${fraction === '' ? '' : `.${fraction}`}`;
}

function offsetText(seconds: number): string {
  if (seconds === 0) return 'Z';
  const magnitude = Math.abs(seconds);
  const rest = magnitude % 60;
  return `${seconds < 0 ? '-' : '+'}${pad(Math.floor(magnitude / 3600))}:${pad(Math.floor(magnitude / 60) % 60)}${rest === 0 ? '' : `:${pad(rest)}`}`;
}

function readWritten(text: string): WrittenDateTime | undefined {
  let rest = text;
  let date: DateFields | undefined;
  let timeFollows = true;
  const dateMatch = DATE_PREFIX.exec(rest);
  if (dateMatch !== null) {
    const [whole, yearDigits = '', month = '', day = ''] = dateMatch;
    if (yearDigits === '-000000') return undefined;
    date = { year: Number(yearDigits), month: Number(month), day: Number(day) };
    rest = rest.slice(whole.length);
    timeFollows = /^[Tt ]/.test(rest);
    if (timeFollows) rest = rest.slice(1);
  }
  let time: TimeFields | undefined;
  let fractionDigits = 0;
  if (timeFollows) {
    const timeMatch = TIME_PREFIX.exec(rest);
    if (timeMatch === null) return undefined;
    const [whole, hour = '', minute = '', second = '00', fraction = ''] = timeMatch;
    time = { hour: Number(hour), minute: Number(minute), second: Number(second), fraction };
    fractionDigits = fraction.length;
    rest = rest.slice(whole.length);
  }
  let offsetSeconds: number | undefined;
  if (rest === 'Z' || rest === 'z') {
    offsetSeconds = 0;
  } else if (rest !== '') {
    const offset = OFFSET.exec(rest);
    if (offset === null) return undefined;
    const [, sign, hours = '', minutes = '00', seconds = '00'] = offset;
    if (Number(minutes) > 59 || Number(seconds) > 59) return undefined;
    const magnitude = Number(hours) * 3600 + Number(minutes) * 60 + Number(seconds);
    offsetSeconds = sign === '-' ? -magnitude : magnitude;
  }
  return { date, time, offsetSeconds, fractionDigits };
}

type Position = readonly [days: number, seconds: number, fraction: string];

interface NormalizedDateTime {
  readonly date: DateFields | undefined;
  readonly time: TimeFields;
  readonly offsetSeconds: number;
}

function normalized(written: WrittenDateTime, shape: DateTimeShape): NormalizedDateTime {
  const clock = written.time ?? MIDNIGHT;
  const offsetSeconds = written.offsetSeconds ?? 0;
  if (written.date === undefined || shape !== 'instant')
    return { date: written.date, time: clock, offsetSeconds };
  const utc =
    daysFromCivil(written.date) * SECONDS_PER_DAY +
    clock.hour * 3600 +
    clock.minute * 60 +
    clock.second -
    offsetSeconds;
  const days = Math.floor(utc / SECONDS_PER_DAY);
  const secondOfDay = utc - days * SECONDS_PER_DAY;
  return {
    date: civilFromDays(days),
    time: {
      hour: Math.floor(secondOfDay / 3600),
      minute: Math.floor(secondOfDay / 60) % 60,
      second: secondOfDay % 60,
      fraction: clock.fraction,
    },
    offsetSeconds: 0,
  };
}

function position(value: NormalizedDateTime): Position {
  const { time } = value;
  return [
    value.date === undefined ? 0 : daysFromCivil(value.date),
    time.hour * 3600 + time.minute * 60 + time.second,
    time.fraction.padEnd(MAX_FRACTION_DIGITS, '0'),
  ];
}

function isBefore(left: Position, right: Position): boolean {
  if (left[0] !== right[0]) return left[0] < right[0];
  if (left[1] !== right[1]) return left[1] < right[1];
  return left[2] < right[2];
}

function printed(value: NormalizedDateTime, shape: DateTimeShape): string {
  const { date, time, offsetSeconds } = value;
  if (date === undefined)
    return shape === 'timeWithOffset'
      ? `${timeText(time)}${offsetText(offsetSeconds)}`
      : timeText(time);
  if (shape === 'date') return dateText(date);
  if (shape === 'dateTime') return `${dateText(date)}T${timeText(time)}`;
  return `${dateText(date)}T${timeText(time)}Z`;
}

function boundPosition(text: string, shape: DateTimeShape): Position {
  const written = readWritten(text);
  if (written === undefined)
    throw new Error(`The range bound "${text}" is not in its stored form.`);
  return position(normalized(written, shape));
}

function dateTimeStoredText(text: string, options: DateTimeOptions, written: string): string {
  const shape = SHAPES[options.shape];
  const id = options.typeId;
  const parts = readWritten(text);
  if (parts === undefined)
    throw new CastRefused(
      `${id} cannot read "${written}". Write ${shape.description}, as in "${shape.example}".`,
    );
  if (parts.date !== undefined && !shape.date)
    throw new CastRefused(
      `${id} holds a time of day without a date, but "${written}" has a date. Write the time alone, as in "${shape.example}".`,
    );
  if (parts.date === undefined && shape.date)
    throw new CastRefused(
      shape.time
        ? `${id} holds ${shape.description}, but "${written}" has no date. Write the date too, as in "${shape.example}".`
        : `${id} holds a date, and "${written}" is a time of day. Write a date, as in "${shape.example}".`,
    );
  if (parts.time !== undefined && !shape.time)
    throw new CastRefused(
      `${id} holds a date without a time of day, but "${written}" has a time. Write the date alone, as in "${shape.example}".`,
    );
  if (parts.time === undefined && shape.offset)
    throw new CastRefused(
      `${id} holds ${shape.description}, but "${written}" has no time of day. Write the time too, as in "${shape.example}".`,
    );
  if (parts.offsetSeconds !== undefined && !shape.offset)
    throw new CastRefused(
      `${id} holds no UTC offset, but "${written}" has one. Leave it out, as in "${shape.example}".`,
    );
  if (parts.offsetSeconds === undefined && shape.offset)
    throw new CastRefused(
      `${id} needs a UTC offset, but "${written}" has none. Add Z for UTC or an offset such as +02:00, as in "${shape.example}".`,
    );
  if (parts.fractionDigits > MAX_FRACTION_DIGITS)
    throw new CastRefused(
      `"${written}" has ${parts.fractionDigits} digits after the decimal point, but ${id} holds microseconds, so at most ${MAX_FRACTION_DIGITS}. Round it, as in "${shape.example.replace(/(\d{2}:\d{2}:\d{2})/, '$1.123456')}".`,
    );
  const { date, time } = parts;
  if (
    date !== undefined &&
    (date.month < 1 ||
      date.month > 12 ||
      date.day < 1 ||
      date.day > daysInMonth(date.year, date.month))
  )
    throw new CastRefused(
      `"${written}" is not a date that exists. Write a real date, as in "${shape.example}".`,
    );
  if (time !== undefined && (time.hour > 23 || time.minute > 59 || time.second > 59))
    throw new CastRefused(
      `"${written}" is not a time of day that exists: hours run from 00 to 23, and minutes and seconds from 00 to 59. Write one, as in "${shape.example}".`,
    );
  const offsetLimit = options.maxOffsetHours ?? 23;
  if (
    parts.offsetSeconds !== undefined &&
    Math.abs(parts.offsetSeconds) >= (offsetLimit + 1) * 3600
  )
    throw new CastRefused(
      `"${written}" has a UTC offset outside -${pad(offsetLimit)}:59 to +${pad(offsetLimit)}:59, which ${id} does not hold. Write a smaller offset, as in "${shape.example}".`,
    );
  const value = normalized(parts, options.shape);
  const { range } = options;
  if (range !== undefined) {
    const at = position(value);
    if (
      isBefore(at, boundPosition(range.earliest, options.shape)) ||
      isBefore(boundPosition(range.latest, options.shape), at)
    )
      throw new CastRefused(
        `${id} holds ${shape.plural} from ${range.earliest} to ${range.latest}, and "${written}" is outside them.`,
      );
  }
  return printed(value, options.shape);
}

const INFINITIES: ReadonlySet<string> = new Set(['infinity', '-infinity']);

function postgresDateTime(
  options: DateTimeOptions,
  holdsInfinity: boolean,
): (text: string) => string {
  return (text) =>
    holdsInfinity && INFINITIES.has(text)
      ? text
      : dateTimeStoredText(isoYearText(text), options, text);
}

function storedForm(
  storedText: (text: string) => string,
  text: string,
): { readonly stored: string } | { readonly reason: string } {
  try {
    return { stored: storedText(text) };
  } catch (error) {
    if (error instanceof CastRefused) return { reason: error.message };
    throw error;
  }
}

const SECONDS_FRACTION = /:\d{2}\.(\d+)/;
const INTERVAL_SECONDS_FRACTION = /\d\.(\d+)S$/;

function storedTextType(
  typeId: string,
  storedText: (text: string) => string,
  description: string,
  fraction: RegExp,
): Pick<PostgresDataType, 'read' | 'spell'> {
  return {
    read: (json, params) => {
      if (typeof json !== 'string') return refuseJsonValue(typeId, description);
      const form = storedForm(storedText, json);
      if ('reason' in form) return refuseJsonValue(typeId, `${description}: ${form.reason}`);
      const precision = integerParam(params, 'precision') ?? MAX_FRACTION_DIGITS;
      if (withoutTrailing(fraction.exec(form.stored)?.[1] ?? '', '0').length > precision)
        return refuseJsonValue(
          typeId,
          `a value with at most ${counted(precision, 'fraction digit')} of a second, which precision ${precision} holds without rounding`,
        );
      return json;
    },
    spell: (json) => {
      if (typeof json !== 'string') return json;
      const form = storedForm(storedText, json);
      return 'stored' in form ? form.stored : json;
    },
  };
}

type ParamRule = (value: Json | undefined) => boolean;

const optionalInteger =
  (min: number, max: number): ParamRule =>
  (value) =>
    value === undefined ||
    (typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max);

interface PostgresDataType {
  readonly params?: Readonly<Record<string, ParamRule>>;
  readonly read: (json: Json, params: Params) => Json;
  readonly spell?: (json: Json, params: Params) => Json;
}

const NUMERIC_PARAMS = {
  precision: optionalInteger(1, 1000),
  scale: optionalInteger(-1000, 1000),
};
const CHARACTER_LENGTH_PARAMS = { length: optionalInteger(1, 10485760) };
const BIT_LENGTH_PARAMS = { length: optionalInteger(1, 83886080) };
const PRECISION_PARAMS = { precision: optionalInteger(0, 6) };
const readString =
  (typeId: string): PostgresDataType['read'] =>
  (json) =>
    readJsonString(typeId, json);
const anyJson: PostgresDataType['read'] = (json) => json;

const requiredInteger =
  (min: number, max: number): ParamRule =>
  (value) =>
    typeof value === 'number' && Number.isInteger(value) && value >= min && value <= max;

const HEX_TEXT = /^(?:[0-9A-Fa-f]{2})*$/;
const EWKB_FLAG_Z = 0x80000000;
const EWKB_FLAG_M = 0x40000000;
const EWKB_FLAG_SRID = 0x20000000;
const EWKB_TYPE_MASK = 0x1fffffff;
const EWKB_POINT = 1;
const EWKB_LINESTRING = 2;
const EWKB_POLYGON = 3;
const EWKB_MULTI_PARTS: ReadonlyMap<number, number> = new Map([
  [4, EWKB_POINT],
  [5, EWKB_LINESTRING],
  [6, EWKB_POLYGON],
]);

class NotEwkb extends Error {}

interface EwkbGeometry {
  readonly srid: number | undefined;
  /** The geometry as the upper-case little-endian HEXEWKB PostGIS prints, or undefined when a coordinate is not finite. */
  readonly printed: string | undefined;
}

/** Reads HEXEWKB in either case and byte order, as `postgis/geometry` of 8.0.0-rc.19 does: points, line strings, polygons and their multi forms, without Z or M coordinates. */
function readEwkb(hex: string): EwkbGeometry {
  const bytes = Buffer.from(hex, 'hex');
  const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const out: number[] = [];
  let offset = 0;
  let finite = true;
  const take = (size: number): number => {
    if (offset + size > view.byteLength) throw new NotEwkb();
    const at = offset;
    offset += size;
    return at;
  };
  const writeUint32 = (value: number): void => {
    const buffer = Buffer.alloc(4);
    buffer.writeUInt32LE(value >>> 0);
    out.push(...buffer);
  };
  const header = (top: boolean): { type: number; little: boolean; srid: number | undefined } => {
    const order = view.getUint8(take(1));
    if (order !== 0 && order !== 1) throw new NotEwkb();
    const little = order === 1;
    const code = view.getUint32(take(4), little) >>> 0;
    if ((code & EWKB_FLAG_Z) !== 0 || (code & EWKB_FLAG_M) !== 0) throw new NotEwkb();
    const type = code & EWKB_TYPE_MASK;
    const srid = (code & EWKB_FLAG_SRID) !== 0 ? view.getUint32(take(4), little) >>> 0 : undefined;
    out.push(1);
    writeUint32(top && srid !== undefined ? type | EWKB_FLAG_SRID : type);
    if (top && srid !== undefined) writeUint32(srid);
    return { type, little, srid };
  };
  const count = (little: boolean): number => {
    const value = view.getUint32(take(4), little) >>> 0;
    writeUint32(value);
    return value;
  };
  const positions = (amount: number, little: boolean): void => {
    for (let index = 0; index < amount * 2; index++) {
      const value = view.getFloat64(take(8), little);
      if (!Number.isFinite(value)) finite = false;
      const buffer = Buffer.alloc(8);
      buffer.writeDoubleLE(value);
      out.push(...buffer);
    }
  };
  const body = (type: number, little: boolean): void => {
    if (type === EWKB_POINT) positions(1, little);
    else if (type === EWKB_LINESTRING) positions(count(little), little);
    else if (type === EWKB_POLYGON)
      for (let ring = count(little); ring > 0; ring--) positions(count(little), little);
    else throw new NotEwkb();
  };
  const top = header(true);
  const part = EWKB_MULTI_PARTS.get(top.type);
  if (part === undefined) body(top.type, top.little);
  else
    for (let index = count(top.little); index > 0; index--) {
      const sub = header(false);
      if (sub.type !== part) throw new NotEwkb();
      body(sub.type, sub.little);
    }
  if (offset !== view.byteLength) throw new NotEwkb();
  return {
    srid: top.srid,
    printed: finite ? Buffer.from(out).toString('hex').toUpperCase() : undefined,
  };
}

function ewkbOf(json: Json): EwkbGeometry | undefined {
  if (typeof json !== 'string') return undefined;
  try {
    return readEwkb(json);
  } catch (error) {
    if (error instanceof NotEwkb) return undefined;
    throw error;
  }
}

function readGeometry(json: Json, params: Params): Json {
  readJsonMatching('postgis/geometry', json, HEX_TEXT, 'a HEXEWKB string');
  const srid = integerParam(params, 'srid');
  const geometry = ewkbOf(json);
  if (geometry === undefined || (srid !== undefined && geometry.srid !== srid))
    return refuseJsonValue(
      'postgis/geometry',
      srid !== undefined ? `a HEXEWKB string of a geometry with SRID ${srid}` : 'a HEXEWKB string',
    );
  return json;
}

function spellGeometry(json: Json): Json {
  const geometry = ewkbOf(json);
  if (geometry === undefined) return json;
  if (geometry.printed === undefined)
    throw new NotAValue('Geometry encode: coordinates must be finite numbers');
  return geometry.printed;
}

/** The text PostgreSQL prints for `value` stored as a `real`: the shortest decimal that reads back as the same single-precision number. */
function realText(value: number): string {
  const single = Math.fround(value);
  for (let digits = 1; digits <= 9; digits++) {
    const text = String(Number(single.toPrecision(digits)));
    if (Math.fround(Number(text)) === single) return text;
  }
  return String(single);
}

function readVector(json: Json, params: Params): Json {
  const length = integerParam(params, 'length');
  const expected =
    length === undefined
      ? 'an array of finite numbers'
      : `an array of ${counted(length, 'finite number')}`;
  if (!Array.isArray(json) || (length !== undefined && json.length !== length))
    return refuseJsonValue('pgvector/vector', expected);
  for (const element of json)
    if (typeof element !== 'number' || !Number.isFinite(element))
      return refuseJsonValue('pgvector/vector', expected);
  for (const [index, element] of json.entries()) {
    if (typeof element !== 'number') continue;
    const refuse = (why: string) =>
      refuseJsonValue(
        'pgvector/vector',
        `an array of numbers real holds exactly; element ${index + 1}, ${element}, ${why}`,
      );
    if (!Number.isFinite(Math.fround(element)))
      return refuse('is outside the range real holds, which PostgreSQL refuses');
    const stored = realText(element);
    if (Number(stored) !== element) return refuse(`would be stored as ${stored}`);
  }
  return json;
}

const POSTGRES_DATA_TYPES: ReadonlyMap<string, PostgresDataType> = new Map<
  string,
  PostgresDataType
>([
  ['pg/text', { read: readString('pg/text') }],
  ['pg/text-array', { read: readTextArray }],
  [
    'pg/enum',
    {
      params: { typeName: (value) => typeof value === 'string' && value.length > 0 },
      read: readString('pg/enum'),
    },
  ],
  ['pg/int2', { read: (json) => readJsonInteger('pg/int2', json, -32768, 32767) }],
  [
    'pg/bool',
    {
      read: (json) => (typeof json === 'boolean' ? json : refuseJsonValue('pg/bool', 'a boolean')),
    },
  ],
  ['pg/json', { read: anyJson }],
  ['pg/tsquery', { read: readString('pg/tsquery') }],
  ['pg/int4', { read: (json) => readJsonInteger('pg/int4', json, -(2 ** 31), 2 ** 31 - 1) }],
  ['pg/int8', { read: readInt8 }],
  ['pg/numeric', { params: NUMERIC_PARAMS, read: readNumeric, spell: spellNumeric }],
  ['pg/float4', { read: readFloat4 }],
  [
    'pg/float8',
    {
      read: (json) => {
        readJsonFloat('pg/float8', json);
        return json;
      },
    },
  ],
  ['pg/jsonb', { read: anyJson }],
  ['pg/char', { params: CHARACTER_LENGTH_PARAMS, read: readCharacter, spell: spellCharacter }],
  ['pg/varchar', { params: CHARACTER_LENGTH_PARAMS, read: readCharacterVarying }],
  [
    'pg/uuid',
    {
      read: (json) =>
        typeof json === 'string' && storedUuid(json) !== undefined
          ? json
          : refuseJsonValue(
              'pg/uuid',
              'a UUID in a spelling PostgreSQL reads: 32 hexadecimal digits in either case, with or without a hyphen after any group of four, optionally in braces',
            ),
      spell: (json) => (typeof json === 'string' ? (storedUuid(json) ?? json) : json),
    },
  ],
  [
    'pg/inet',
    {
      read: (json) =>
        typeof json === 'string' && storedInet(json) !== undefined
          ? json
          : refuseJsonValue(
              'pg/inet',
              'an IP address or network in a spelling PostgreSQL reads, as in 10.0.0.1 or 2001:db8::/32',
            ),
      spell: (json) => (typeof json === 'string' ? (storedInet(json) ?? json) : json),
    },
  ],
  ['pg/bit', { params: BIT_LENGTH_PARAMS, read: readBit }],
  ['pg/varbit', { params: BIT_LENGTH_PARAMS, read: readBitVarying }],
  [
    'pg/timetz',
    {
      params: PRECISION_PARAMS,
      ...storedTextType(
        'pg/timetz',
        postgresDateTime(
          { shape: 'timeWithOffset', typeId: 'pg/timetz', maxOffsetHours: 15 },
          false,
        ),
        'a time of day with its UTC offset, as in "12:34:56+02:00" or "12:34:56Z"',
        SECONDS_FRACTION,
      ),
    },
  ],
  [
    'pg/interval',
    {
      params: PRECISION_PARAMS,
      ...storedTextType(
        'pg/interval',
        intervalStoredText,
        'an ISO 8601 duration, as in "P1Y2M3DT4H5M6.5S"',
        INTERVAL_SECONDS_FRACTION,
      ),
    },
  ],
  [
    'pg/bytea',
    {
      read: (json) => readJsonMatching('pg/bytea', json, BASE64_TEXT, 'a base64 string'),
      spell: spellBytea,
    },
  ],
  [
    'pg/date',
    storedTextType(
      'pg/date',
      postgresDateTime(
        {
          shape: 'date',
          typeId: 'pg/date',
          range: { earliest: '-004713-11-24', latest: '+275760-09-13' },
        },
        true,
      ),
      'a date, as in "2024-01-01", or infinity or -infinity',
      SECONDS_FRACTION,
    ),
  ],
  [
    'pg/time',
    {
      params: PRECISION_PARAMS,
      ...storedTextType(
        'pg/time',
        postgresDateTime({ shape: 'time', typeId: 'pg/time' }, false),
        'a time of day, as in "12:34:56"',
        SECONDS_FRACTION,
      ),
    },
  ],
  [
    'pg/timestamp',
    {
      params: PRECISION_PARAMS,
      ...storedTextType(
        'pg/timestamp',
        postgresDateTime(
          {
            shape: 'dateTime',
            typeId: 'pg/timestamp',
            range: { earliest: '-004713-11-24T00:00:00', latest: '+275760-09-13T23:59:59.999999' },
          },
          true,
        ),
        'a date and time of day, as in "2024-01-01T12:34:56", or infinity or -infinity',
        SECONDS_FRACTION,
      ),
    },
  ],
  [
    'pg/timestamptz',
    {
      params: PRECISION_PARAMS,
      ...storedTextType(
        'pg/timestamptz',
        postgresDateTime(
          {
            shape: 'instant',
            typeId: 'pg/timestamptz',
            range: { earliest: '-004713-11-24T00:00:00Z', latest: '+275760-09-13T00:00:00Z' },
          },
          true,
        ),
        'an instant in UTC, as in "2024-01-01T00:00:00Z", or infinity or -infinity',
        SECONDS_FRACTION,
      ),
    },
  ],
  [
    'postgis/geometry',
    {
      params: { srid: optionalInteger(1, Number.POSITIVE_INFINITY) },
      read: readGeometry,
      spell: spellGeometry,
    },
  ],
  ['pgvector/vector', { params: { length: requiredInteger(1, 16000) }, read: readVector }],
]);

function resolvedTypeParams(column: JsonRecord, namedTypes: Json | undefined): Json | undefined {
  const typeRef = column['typeRef'];
  const named =
    typeof typeRef === 'string' && isRecord(namedTypes) ? namedTypes[typeRef] : undefined;
  const typeParams = column['typeParams'] ?? (isRecord(named) ? named['typeParams'] : undefined);
  return isRecord(typeParams) && Object.keys(typeParams).length > 0 ? typeParams : undefined;
}

/** The parameters of the column that its data type declares, or undefined when the type refuses them. */
function declaredParams(type: PostgresDataType, typeParams: Json | undefined): Params | undefined {
  const params: Record<string, Json> = {};
  for (const [name, accepts] of Object.entries(type.params ?? {})) {
    const value = isRecord(typeParams) ? typeParams[name] : undefined;
    if (!accepts(value)) return undefined;
    if (value !== undefined) params[name] = value;
  }
  if (params['scale'] !== undefined && params['precision'] === undefined) return undefined;
  return params;
}

interface ColumnType {
  readonly id: string;
  readonly type: PostgresDataType;
  readonly params: Params;
  readonly list: boolean;
}

/** The column's data type and parameters, or undefined when this release does not register the type or refuses the parameters, and so does not read the default. */
function columnType(column: JsonRecord, namedTypes: Json | undefined): ColumnType | undefined {
  const id = column['dataType'];
  const type = typeof id === 'string' ? POSTGRES_DATA_TYPES.get(id) : undefined;
  if (typeof id !== 'string' || type === undefined) return undefined;
  const params = declaredParams(type, resolvedTypeParams(column, namedTypes));
  if (params === undefined) return undefined;
  const many = column['many'];
  return { id, type, params, list: many !== undefined && many !== false };
}

/** A literal default value in the contract form this release stores. */
function contractFormOfDefault(value: Json, { type, params }: ColumnType): DefaultForm {
  let stored: Json;
  try {
    const read = type.read(value, params);
    stored = type.spell === undefined ? read : type.spell(read, params);
  } catch (error) {
    if (error instanceof NotAValue) return { kind: 'notAValue', reason: error.message };
    throw error;
  }
  return canonicalizeJson(stored) === canonicalizeJson(value)
    ? { kind: 'unchanged' }
    : { kind: 'rewritten', value: stored };
}

type StoredDefault =
  | { readonly kind: 'stored'; readonly value: Json }
  | { readonly kind: 'refused'; readonly reason: string };

/** A column's default in the contract form this release stores, element by element on a list column, or why this release refuses it. */
function storedDefault(value: Json, columnType: ColumnType): StoredDefault {
  if (value === null) return { kind: 'stored', value };
  if (columnType.list && !Array.isArray(value))
    return {
      kind: 'refused',
      reason: `the default ${JSON.stringify(value)} is not a list, and the column holds a list of ${columnType.id}`,
    };
  const values = columnType.list && Array.isArray(value) ? value : [value];
  const stored: Json[] = [];
  for (const element of values) {
    const form = element === null ? undefined : contractFormOfDefault(element, columnType);
    if (form?.kind === 'notAValue')
      return {
        kind: 'refused',
        reason: `the default ${JSON.stringify(element)} is not a value of ${columnType.id} (${form.reason})`,
      };
    stored.push(form?.kind === 'rewritten' ? form.value : element);
  }
  return { kind: 'stored', value: columnType.list ? stored : (stored[0] ?? null) };
}

/** The scalar values that changed between two defaults, pairing list elements by position, for the literal types of `contract.d.ts`. */
function defaultRewrites(from: Json, to: Json): DefaultRewrite[] {
  const pairs: [Json, Json][] =
    Array.isArray(from) && Array.isArray(to)
      ? from.length === to.length
        ? from.map((element, index) => [element, to[index] ?? null])
        : []
      : [[from, to]];
  return pairs.flatMap(([a, b]) =>
    (typeof a === 'string' && typeof b === 'string') ||
    (typeof a === 'number' && typeof b === 'number')
      ? a === b
        ? []
        : [{ from: a, to: b }]
      : [],
  );
}

/** How `--default` names a column: `<namespace>.<table>.<column>`. */
function defaultKey(namespaceId: string, tableName: string, columnName: string): string {
  return `${namespaceId}.${tableName}.${columnName}`;
}

interface ColumnEntry {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly columnName: string;
  readonly column: JsonRecord;
}

function columnsOf(contract: JsonRecord): ColumnEntry[] {
  const storage = contract['storage'];
  const namespaces = isRecord(storage) ? storage['namespaces'] : undefined;
  return Object.entries(isRecord(namespaces) ? namespaces : {}).flatMap(
    ([namespaceId, namespace]) => {
      const entries = isRecord(namespace) ? namespace['entries'] : undefined;
      const tables = isRecord(entries) ? entries['table'] : undefined;
      return Object.entries(isRecord(tables) ? tables : {}).flatMap(([tableName, table]) => {
        const columns = isRecord(table) ? table['columns'] : undefined;
        return Object.entries(isRecord(columns) ? columns : {}).flatMap(([columnName, column]) =>
          isRecord(column) ? [{ namespaceId, tableName, columnName, column }] : [],
        );
      });
    },
  );
}

/** Mutates `copy`: each literal default in the contract form this release stores, element by element on a list column. A default this release refuses takes the value given for its column with `--default`, and each column whose replacement was taken is added to `used`. */
function rewriteDefaults(
  copy: JsonRecord,
  replacements: ReadonlyMap<string, Json>,
  used: Set<string>,
): {
  readonly defaults: Map<string, DefaultRewrite[]>;
  readonly notValues: string[];
} {
  const defaults = new Map<string, DefaultRewrite[]>();
  const notValues: string[] = [];
  const storage = copy['storage'];
  const namedTypes = isRecord(storage) ? storage['types'] : undefined;
  for (const { namespaceId, tableName, columnName, column } of columnsOf(copy)) {
    const columnDefault = column['default'];
    if (!isRecord(columnDefault) || columnDefault['kind'] !== 'literal') continue;
    const original = columnDefault['value'];
    const type = columnType(column, namedTypes);
    if (original === undefined || type === undefined) continue;
    const place = `namespace ${namespaceId}, table ${tableName}, column ${columnName}`;
    const key = defaultKey(namespaceId, tableName, columnName);
    let stored = storedDefault(original, type);
    if (stored.kind === 'refused') {
      const replacement = replacements.get(key);
      if (replacement === undefined) {
        notValues.push(
          `${place}: ${stored.reason}; choose the value the database stores and run the script again with --default '${key}=<that value as JSON>'`,
        );
        continue;
      }
      used.add(key);
      stored = storedDefault(replacement, type);
      if (stored.kind === 'refused') {
        notValues.push(`${place}: --default ${key}: ${stored.reason}`);
        continue;
      }
    }
    if (canonicalizeJson(stored.value) === canonicalizeJson(original)) continue;
    columnDefault['value'] = stored.value;
    defaults.set(
      listKey(namespaceId, tableName, columnName),
      defaultRewrites(original, stored.value),
    );
  }
  return { defaults, notValues };
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

/** The contract with the key removed from each column, the lists whose element check it waived made element-nullable, and each default in the contract form this release stores. */
function rewriteContract(
  contract: JsonRecord,
  replacements: ReadonlyMap<string, Json>,
  used: Set<string>,
): Rewrite {
  const copy = parseJson(JSON.stringify(contract));
  if (!isRecord(copy))
    return {
      contract,
      changed: false,
      columns: new Set(),
      fields: new Set(),
      defaults: new Map(),
      notValues: [],
    };
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
  const { defaults, notValues } =
    contract['target'] === 'postgres'
      ? rewriteDefaults(copy, replacements, used)
      : { defaults: new Map<string, DefaultRewrite[]>(), notValues: [] };
  return {
    contract: copy,
    changed: changed || defaults.size > 0,
    columns,
    fields: fieldsMappingColumns(copy, columns),
    defaults,
    notValues,
  };
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
      const before = text.slice(Math.max(0, index - 200), index);
      const key =
        /(?:readonly\s+)?([\p{ID_Start}_$][\p{ID_Continue}$]*|'[^']*'|"[^"]*")\s*\??\s*:\s*$/u.exec(
          before,
        ) ?? /\b(?:type|namespace)\s+([\p{ID_Start}_$][\p{ID_Continue}$]*)\s*=?\s*$/u.exec(before);
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

const FIELD_TYPE_MAPS = new Set(['FieldOutputTypes', 'FieldInputTypes']);
const COLUMN_TYPE_MAPS = new Set(['StorageColumnTypes', 'StorageColumnInputTypes']);

/** Whether a row type member names a waived list: in the field and column type maps, keyed namespace, model or table, member; or in a `Models` type alias, `<namespace>_<Model>` or `<Model>`. */
function isWaivedRowMember(
  block: Block,
  member: string,
  columns: ReadonlySet<string>,
  fields: ReadonlySet<string>,
): boolean {
  const namespace = block.parent;
  const map = namespace?.parent;
  if (map !== undefined && map.parent === undefined) {
    const key = listKey(namespace?.label ?? '', block.label, member);
    if (FIELD_TYPE_MAPS.has(map.label)) return fields.has(key);
    if (COLUMN_TYPE_MAPS.has(map.label)) return columns.has(key);
  }
  if (namespace?.label !== 'Models' || namespace.parent !== undefined) return false;
  return [...fields].some((key) => {
    const [fieldNamespace, model, field] = key.split('\u0000');
    return (
      field === member && (block.label === model || block.label === `${fieldNamespace}_${model}`)
    );
  });
}

/** The end of the type argument that starts at `start`: the index of its closing `>`. */
function typeArgumentEnd(text: string, start: number): number {
  let depth = 1;
  let quote: string | undefined;
  for (let index = start; index < text.length; index++) {
    const char = text[index];
    if (quote !== undefined) {
      if (char === '\\') index++;
      else if (char === quote) quote = undefined;
    } else if (char === "'" || char === '"' || char === '`') quote = char;
    else if (char === '<') depth++;
    else if (char === '>' && text[index - 1] !== '=' && --depth === 0) return index;
  }
  return -1;
}

function quoted(text: string, quote: string): string {
  return `${quote}${text.replaceAll('\\', '\\\\').replaceAll(quote, `\\${quote}`)}${quote}`;
}

const NUMBER_TOKEN = /(?<![\w.$'"])-?\d+(?:\.\d+)?(?:e[+-]?\d+)?(?![\w.$'"])/gi;

/** A default's literal type with each rewritten value replaced: a string in either quote, a number as its own token. */
function withRewrittenLiterals(literal: string, rewrites: readonly DefaultRewrite[]): string {
  let result = literal;
  const numbers = new Map<number, number>();
  for (const { from, to } of rewrites) {
    if (typeof from === 'number' && typeof to === 'number') numbers.set(from, to);
    if (typeof from === 'string' && typeof to === 'string')
      for (const quote of ["'", '"'])
        result = result.replaceAll(quoted(from, quote), quoted(to, quote));
  }
  if (numbers.size === 0) return result;
  return result.replace(NUMBER_TOKEN, (token) => String(numbers.get(Number(token)) ?? token));
}

function rewriteDts(
  text: string,
  columns: ReadonlySet<string>,
  fields: ReadonlySet<string>,
  defaults: ReadonlyMap<string, readonly DefaultRewrite[]>,
  hashes: ReadonlyMap<string, string>,
): string {
  const blocks = scanBlocks(text);
  const edits: { start: number; end: number; text: string }[] = [];
  for (const match of text.matchAll(/DefaultLiteralValue</g)) {
    const holder = innermostBlock(blocks, match.index);
    const column = holder?.label === 'default' ? holder.parent : undefined;
    const key = column === undefined ? undefined : columnBlockKey(column);
    const rewrites = key === undefined ? undefined : defaults.get(key);
    const end = typeArgumentEnd(text, match.index + match[0].length);
    if (rewrites === undefined || end === -1) continue;
    const codecEnd = /^\s*(['"])(?:\\.|(?!\1).)*\1/.exec(
      text.slice(match.index + match[0].length, end),
    );
    const start = match.index + match[0].length + (codecEnd?.[0].length ?? 0);
    edits.push({ start, end, text: withRewrittenLiterals(text.slice(start, end), rewrites) });
  }
  const rowMember =
    /(?:readonly\s+)?([\p{ID_Start}_$][\p{ID_Continue}$]*|'[^']*'|"[^"]*")\s*\??\s*:\s*ReadonlyArray</gu;
  for (const match of text.matchAll(rowMember)) {
    const block = innermostBlock(blocks, match.index);
    const member = match[1]?.replace(/^['"]|['"]$/g, '') ?? '';
    if (block === undefined || !isWaivedRowMember(block, member, columns, fields)) continue;
    const elementStart = match.index + match[0].length;
    const elementEnd = typeArgumentEnd(text, elementStart);
    if (elementEnd === -1 || /\|\s*null\s*$/.test(text.slice(elementStart, elementEnd))) continue;
    edits.push({ start: elementEnd, end: elementEnd, text: ' | null' });
  }
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
  readonly defaults: ReadonlyMap<string, readonly DefaultRewrite[]>;
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
    return ['No contract stores a noCheck key or a default in another form; nothing changed.'];
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

const USAGE =
  'Usage: node remove-nocheck.ts [project-root] [--default <namespace>.<table>.<column>=<JSON value>]...';

interface Args {
  readonly root: string;
  readonly replacements: ReadonlyMap<string, Json>;
  readonly errors: readonly string[];
}

function parseArgs(args: readonly string[]): Args {
  const errors: string[] = [];
  const positional: string[] = [];
  const replacements = new Map<string, Json>();
  for (let index = 0; index < args.length; index++) {
    const arg = args[index] ?? '';
    const given = arg === '--default' ? args[++index] : undefined;
    const option = arg.startsWith('--default=') ? arg.slice('--default='.length) : given;
    if (option === undefined && !arg.startsWith('-')) {
      positional.push(arg);
      continue;
    }
    if (option === undefined && arg !== '--default') {
      errors.push(`${arg}: unknown option`);
      continue;
    }
    const separator = option?.indexOf('=') ?? -1;
    const value = option === undefined ? undefined : parseJson(option.slice(separator + 1));
    if (option === undefined || separator < 1 || value === undefined) {
      const shown = option === undefined ? '--default' : `--default ${option}`;
      errors.push(`${shown}: expected <namespace>.<table>.<column>=<JSON value>`);
      continue;
    }
    replacements.set(option.slice(0, separator), value);
  }
  if (positional.length > 1) errors.push(`expected one project root, got ${positional.length}`);
  const root = resolve(positional[0] ?? process.cwd());
  if (errors.length === 0 && !isDirectory(root)) errors.push(`${root}: not a directory`);
  if (errors.length > 0) errors.push(USAGE);
  return { root, replacements, errors };
}

function main({ root, replacements, errors }: Args): number {
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    return 1;
  }
  const display = (path: string): string => relative(root, path).split(sep).join('/');
  const files = listFiles(root);
  const plans: ContractPlan[] = [];
  const stops: string[] = [];
  let contractsFound = 0;
  const used = new Set<string>();

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
    const rewrite = rewriteContract(contract, replacements, used);
    for (const problem of rewrite.notValues) stops.push(`${display(path)}: ${problem}`);
    if (!rewrite.changed || rewrite.notValues.length > 0) continue;
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
      defaults: rewrite.defaults,
    });
  }

  for (const key of replacements.keys())
    if (!used.has(key))
      stops.push(
        `--default ${key}: no stored contract has a default of this column that this release refuses, so the script replaces nothing`,
      );

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
      ? rewriteDts(
          readFileSync(dtsPath, 'utf8'),
          plan.columns,
          plan.fields,
          plan.defaults,
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
  const lines = [...summary(root, contractsFound, rewrittenFiles, removals.size, hashes)];
  process.stdout.write(`${lines.join('\n')}\n`);
  return 0;
}

process.exitCode = main(parseArgs(process.argv.slice(2)));
