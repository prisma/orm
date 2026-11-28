#!/usr/bin/env node
/**
 * Gives every file Prisma stores in a project its format version. A `contract.json` (emitted next to the contract source, bundled by an extension, or a copy under `migrations/snapshots/<hash>/`) had `"schemaVersion": "1"`; it now has `"formatVersion": 1`. A `migration.json` and a ref file (`refs/<name>.json`, including an extension's `refs/head.json`) had no version; they now start with `"formatVersion": 1`. Until `8.0.0` a release reads a file without it as the format a release candidate wrote; `8.0.0` refuses it.
 *
 * Usage: node stored-files-format-version.ts [project-root]
 *
 * The project root defaults to the working directory. The script walks it, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot. It recognises a contract by its content (`targetFamily`, `storage` and `schemaVersion` at the top level) in any `*.json` file, a `migration.json` by its fields and by the `ops.json` next to it, and a ref file by where Prisma writes refs or by its content. Every `*.json` file in `<migrations>/<space>/refs/` (in an application) or `<migrations>/refs/` (in an extension's own repository) is a ref, where a migrations directory is one holding the contract snapshot store (`snapshots/<hash>/contract.json`) or a migration package, whatever it is named. A `*.json` file in any other `refs` directory is a ref when its content is one: a `hash` that is `empty` or a storage hash, and an `invariants` list of strings. This finds the refs of a space with no migrations after `snapshots/` was deleted. Any other JSON file in a `refs` directory is not Prisma's and is left alone. It edits each file's text in place, so the rest of the file keeps its bytes: the version goes first, except in a contract whose top-level keys are sorted (a snapshot), where it goes in sorted position, as Prisma writes them. No hash covers the version, so no hash changes.
 *
 * A ref file may have fields the format does not have; earlier releases ignored them when they read a ref and dropped them when they wrote one again. The script drops them too, and lists each one it dropped.
 *
 * It prints each file it changed. These are reported, left unchanged, and make it exit 1, while it still changes every other file: a `contract.json`, `migration.json` or ref file it cannot read or parse; a ref file or `migration.json` whose content is not one that a release of Prisma read (a missing or extra field, or a value of the wrong type); a contract with both `formatVersion` and `schemaVersion`, or a `contract.json` holding a contract with neither; a contract whose `schemaVersion` is not `"1"`; a directory it cannot list; and a symbolic link to a file or folder outside the project root that holds a stored file it would change or report, since it does not follow links. A second run changes nothing.
 */
import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

type Json = null | boolean | number | string | Json[] | JsonRecord;
interface JsonRecord {
  [key: string]: Json;
}

type StoredFileKind = 'contract' | 'snapshot' | 'migration' | 'ref';

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const SPACE_ID = /^[a-z][a-z0-9_-]{0,63}$/;
const STORAGE_HASH = /^[0-9a-f]{64}$/;
const REF_HASH = /^(empty|[0-9a-f]{64})$/;
const BYTE_ORDER_MARK = '﻿';
const MIGRATION_FIELDS = ['from', 'to', 'migrationHash', 'providedInvariants', 'createdAt'];
const MIGRATION_KEYS = new Set(MIGRATION_FIELDS);
const REF_KEYS = new Set(['hash', 'invariants', 'policies']);

interface Member {
  readonly key: string;
  readonly keyStart: number;
  readonly keyEnd: number;
  readonly valueStart: number;
  readonly valueEnd: number;
}

interface ObjectLayout {
  readonly open: number;
  readonly members: readonly Member[];
}

interface Outcome {
  readonly changed: string[];
  readonly problems: string[];
  readonly dropped: string[];
}

function emptyOutcome(): Outcome {
  return { changed: [], problems: [], dropped: [] };
}

function isRecord(value: unknown): value is JsonRecord {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function isStringArray(value: unknown): boolean {
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}

function compareCodeUnits(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function skipWhitespace(text: string, index: number): number {
  let i = index;
  while (i < text.length && ' \t\n\r'.includes(text.charAt(i))) i++;
  return i;
}

function endOfString(text: string, start: number): number {
  let i = start + 1;
  while (text.charAt(i) !== '"') i += text.charAt(i) === '\\' ? 2 : 1;
  return i + 1;
}

function endOfValue(text: string, start: number): number {
  const first = text.charAt(start);
  if (first === '"') return endOfString(text, start);
  if (first === '{' || first === '[') {
    let depth = 0;
    let i = start;
    while (i < text.length) {
      const char = text.charAt(i);
      if (char === '"') {
        i = endOfString(text, i);
        continue;
      }
      if (char === '{' || char === '[') depth++;
      else if (char === '}' || char === ']') {
        depth--;
        if (depth === 0) return i + 1;
      }
      i++;
    }
    return i;
  }
  let i = start;
  while (i < text.length && !',}] \t\n\r'.includes(text.charAt(i))) i++;
  return i;
}

/** The top-level members of a JSON object text that `JSON.parse` accepted, with their positions. */
function objectLayout(text: string): ObjectLayout {
  const open = skipWhitespace(text, 0);
  const members: Member[] = [];
  let i = skipWhitespace(text, open + 1);
  while (text.charAt(i) === '"') {
    const keyStart = i;
    const keyEnd = endOfString(text, keyStart);
    const key: string = JSON.parse(text.slice(keyStart, keyEnd));
    const valueStart = skipWhitespace(text, skipWhitespace(text, keyEnd) + 1);
    const valueEnd = endOfValue(text, valueStart);
    members.push({ key, keyStart, keyEnd, valueStart, valueEnd });
    i = skipWhitespace(text, valueEnd);
    if (text.charAt(i) === ',') i = skipWhitespace(text, i + 1);
  }
  return { open, members };
}

function separatorBefore(text: string, layout: ObjectLayout, index: number): string {
  const member = layout.members[index];
  if (member === undefined) return '';
  const previous = layout.members[index - 1];
  if (previous === undefined) return text.slice(layout.open + 1, member.keyStart);
  return text.slice(text.indexOf(',', previous.valueEnd) + 1, member.keyStart);
}

function withoutMember(text: string, key: string): string {
  const { members } = objectLayout(text);
  const index = members.findIndex((member) => member.key === key);
  const member = members[index];
  if (member === undefined) return text;
  const next = members[index + 1];
  if (next !== undefined) return text.slice(0, member.keyStart) + text.slice(next.keyStart);
  const previous = members[index - 1];
  const start = previous === undefined ? member.keyStart : previous.valueEnd;
  return text.slice(0, start) + text.slice(member.valueEnd);
}

function keysAreSorted(keys: readonly string[]): boolean {
  return (
    keys.length > 1 &&
    keys.every((key, i) => i === 0 || compareCodeUnits(keys[i - 1] ?? '', key) < 0)
  );
}

/** `text` with `"formatVersion": 1` added as a top-level member, written in the file's own spacing. */
function withFormatVersion(text: string, placement: 'first' | 'sorted-when-sorted'): string {
  const layout = objectLayout(text);
  const { members } = layout;
  const first = members[0];
  if (first === undefined) return text;
  const keys = members.map((member) => member.key);
  const position =
    placement === 'sorted-when-sorted' && keysAreSorted(keys)
      ? keys.filter((key) => compareCodeUnits(key, 'formatVersion') < 0).length
      : 0;
  const colon = text.slice(first.keyEnd, first.valueStart);
  const entry = `"formatVersion"${colon}1`;
  const between = separatorBefore(text, layout, members.length > 1 ? Math.max(position, 1) : 0);
  const before = members[position];
  if (before !== undefined)
    return `${text.slice(0, before.keyStart)}${entry},${between}${text.slice(before.keyStart)}`;
  const last = members[members.length - 1] ?? first;
  return `${text.slice(0, last.valueEnd)},${between}${entry}${text.slice(last.valueEnd)}`;
}

function sameMembersBesidesVersion(
  original: JsonRecord,
  rewritten: Json,
  dropped: readonly string[],
): boolean {
  if (!isRecord(rewritten) || rewritten['formatVersion'] !== 1 || 'schemaVersion' in rewritten)
    return false;
  const removed = new Set(['schemaVersion', ...dropped]);
  const rest = Object.fromEntries(Object.entries(original).filter(([key]) => !removed.has(key)));
  const { formatVersion: _, ...rewrittenRest } = rewritten;
  return JSON.stringify(rest) === JSON.stringify(rewrittenRest);
}

function quotedList(keys: readonly string[]): string {
  return keys.map((key) => JSON.stringify(key)).join(', ');
}

function isContract(value: JsonRecord): boolean {
  return typeof value['targetFamily'] === 'string' && isRecord(value['storage']);
}

function migrationFieldHolds(field: string, value: Json): boolean {
  if (field === 'from') return value === null || typeof value === 'string';
  if (field === 'providedInvariants') return isStringArray(value);
  return typeof value === 'string';
}

/** What keeps `value` from being a `migration.json` that a release of Prisma read, or undefined when nothing does. */
function migrationMetadataProblem(value: JsonRecord): string | undefined {
  const unknown = Object.keys(value).filter((key) => !MIGRATION_KEYS.has(key));
  if (unknown.length > 0) {
    const fields = unknown.length === 1 ? 'the field' : 'the fields';
    const them = unknown.length === 1 ? 'the field' : 'them';
    return `it has ${fields} ${quotedList(unknown)}, which a migration.json does not have, so no release read it. Remove ${them} and run the script again`;
  }
  for (const field of MIGRATION_FIELDS) {
    const fieldValue = value[field];
    if (fieldValue === undefined || !migrationFieldHolds(field, fieldValue)) {
      const what =
        fieldValue === undefined
          ? `it has no "${field}", which every migration.json has`
          : `its "${field}" is ${JSON.stringify(fieldValue)}, which is not what a migration.json holds there`;
      return `${what}, so no release read it. Plan the migration again, or restore the file from version control`;
    }
  }
  return undefined;
}

/** What keeps `value` from being a ref file that a release of Prisma read, or undefined when nothing does. Fields a ref file does not have are not a problem: earlier releases ignored them. */
function refProblem(value: JsonRecord): string | undefined {
  const shape = 'a ref file has "hash" and "invariants", and this one';
  if (typeof value['hash'] !== 'string')
    return `${shape} has no "hash" string. Write the hash the ref should name, or delete the file, and run the script again`;
  if (!isStringArray(value['invariants']))
    return `${shape} has no "invariants" list. Add "invariants": [] (or the invariants the ref should carry) and run the script again`;
  return undefined;
}

function isDirectory(path: string): boolean {
  try {
    return statSync(path).isDirectory();
  } catch {
    return false;
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
    (path, name) => STORAGE_HASH.test(name) && existsSync(join(path, 'contract.json')),
  );
}

/** Whether `dir` holds what Prisma writes to a migrations directory: its contract snapshot store, or a migration package. */
function isMigrationsDirectory(dir: string): boolean {
  return isSnapshotStore(join(dir, 'snapshots')) || hasSubdirectory(dir, isMigrationPackage);
}

/** Whether `path` is where Prisma writes a ref: `refs/` in an application's space directory under the migrations directory, or directly in an extension's migrations directory. */
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

/** Whether `value` holds what Prisma writes to a ref file, besides fields a ref file does not have. */
function hasRefContent(value: JsonRecord): boolean {
  const hash = value['hash'];
  return typeof hash === 'string' && REF_HASH.test(hash) && isStringArray(value['invariants']);
}

/** The kind of stored file `path` is by its name and place, before its content is read. */
function expectedKind(root: string, path: string): StoredFileKind | undefined {
  const name = basename(path);
  if (name === 'migration.json' && isMigrationPackage(dirname(path))) return 'migration';
  if (!name.endsWith('.contract.json') && isRefLocation(root, path)) return 'ref';
  if (name === 'contract.json') return isSnapshot(path) ? 'snapshot' : 'contract';
  return undefined;
}

function isSnapshot(path: string): boolean {
  const hashDir = dirname(path);
  return STORAGE_HASH.test(basename(hashDir)) && basename(dirname(hashDir)) === 'snapshots';
}

type Rewrite =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rewritten'; readonly text: string; readonly dropped: readonly string[] }
  | { readonly kind: 'problem'; readonly reason: string };

function rewriteRef(text: string, value: JsonRecord): Rewrite {
  const problem = refProblem(value);
  if (problem !== undefined) return { kind: 'problem', reason: problem };
  const dropped = Object.keys(value).filter((key) => !REF_KEYS.has(key));
  const kept = dropped.reduce((current, key) => withoutMember(current, key), text);
  return { kind: 'rewritten', text: withFormatVersion(kept, 'first'), dropped };
}

function rewrite(text: string, value: JsonRecord, expected: StoredFileKind | undefined): Rewrite {
  if ('formatVersion' in value) {
    if ('schemaVersion' in value && isContract(value))
      return {
        kind: 'problem',
        reason: 'it has both "formatVersion" and "schemaVersion". Delete the "schemaVersion" field',
      };
    return { kind: 'unchanged' };
  }
  if (expected === 'migration') {
    const problem = migrationMetadataProblem(value);
    if (problem !== undefined) return { kind: 'problem', reason: problem };
    return { kind: 'rewritten', text: withFormatVersion(text, 'first'), dropped: [] };
  }
  if (expected === 'ref') return rewriteRef(text, value);
  if (!isContract(value)) return { kind: 'unchanged' };
  if (!('schemaVersion' in value)) {
    if (expected !== 'contract' && expected !== 'snapshot') return { kind: 'unchanged' };
    const remedy =
      expected === 'snapshot'
        ? 'Restore it from version control'
        : 'Emit it again with `prisma contract emit`, or restore it from version control';
    return {
      kind: 'problem',
      reason: `it has neither "formatVersion" nor "schemaVersion", so no release of Prisma wrote it. ${remedy}`,
    };
  }
  if (value['schemaVersion'] !== '1')
    return {
      kind: 'problem',
      reason: `its "schemaVersion" is ${JSON.stringify(value['schemaVersion'])}, which no release of Prisma wrote`,
    };
  return {
    kind: 'rewritten',
    text: withFormatVersion(withoutMember(text, 'schemaVersion'), 'sorted-when-sorted'),
    dropped: [],
  };
}

const NOT_AN_OBJECT: Partial<Record<StoredFileKind, string>> = {
  migration: 'a migration.json is a JSON object, and this one is not an object',
  ref: 'a ref file is a JSON object with "hash" and "invariants", and this one is not an object',
};

/** Rewrites the stored file at `path`, or, when `write` is false, only records what a rewrite would do. */
function handleFile(root: string, path: string, outcome: Outcome, write = true): void {
  const expected = expectedKind(root, path);
  const shown = relative(root, path);
  let raw: string;
  try {
    raw = readFileSync(path, 'utf8');
  } catch (error) {
    if (expected !== undefined)
      outcome.problems.push(`${shown}: cannot be read (${errorText(error)})`);
    return;
  }
  const bom = raw.startsWith(BYTE_ORDER_MARK) ? BYTE_ORDER_MARK : '';
  const text = raw.slice(bom.length);
  let value: Json;
  try {
    value = JSON.parse(text);
  } catch (error) {
    if (expected !== undefined)
      outcome.problems.push(`${shown}: is not valid JSON (${errorText(error)})`);
    return;
  }
  if (!isRecord(value)) {
    const reason = expected === undefined ? undefined : NOT_AN_OBJECT[expected];
    if (reason !== undefined) outcome.problems.push(`${shown}: ${reason}`);
    return;
  }
  const kind =
    expected ?? (isInRefsDirectory(root, path) && hasRefContent(value) ? 'ref' : undefined);
  const result = rewrite(text, value, kind);
  if (result.kind === 'unchanged') return;
  if (result.kind === 'problem') {
    outcome.problems.push(`${shown}: ${result.reason}`);
    return;
  }
  if (!sameMembersBesidesVersion(value, JSON.parse(result.text), result.dropped)) {
    outcome.problems.push(`${shown}: could not be rewritten without changing other content`);
    return;
  }
  try {
    if (write) writeFileSync(path, bom + result.text);
    outcome.changed.push(shown);
    if (result.dropped.length > 0) outcome.dropped.push(`${shown}: ${quotedList(result.dropped)}`);
  } catch (error) {
    outcome.problems.push(`${shown}: cannot be written (${errorText(error)})`);
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

function isWalked(name: string): boolean {
  return !SKIPPED_DIRECTORIES.has(name) && !name.startsWith('.');
}

function isInside(dir: string, path: string): boolean {
  return path === dir || path.startsWith(`${dir}${sep}`);
}

/**
 * Reports a symbolic link to a file or folder outside the project root that holds a stored file the script would change or report. The script does not follow links: a link inside the root leads to files the walk reaches anyway, a link to the root or a folder above it leads back to the project itself, and any other link leads to files that may belong to another project.
 */
function handleLink(root: string, path: string, name: string, outcome: Outcome): void {
  let target: string;
  try {
    target = realpathSync(path);
  } catch {
    return;
  }
  const realRoot = realpathSync(root);
  if (isInside(realRoot, target) || isInside(target, realRoot)) return;
  const shown = relative(root, path);
  const targetShown = relative(realRoot, target);
  const probe = emptyOutcome();
  const isDirectory = statSync(target).isDirectory();
  if (isDirectory) {
    if (!isWalked(name)) return;
    visit(root, path, probe, false);
  } else if (name.endsWith('.json')) {
    handleFile(root, path, probe, false);
  }
  if (probe.changed.length === 0 && probe.problems.length === 0) return;
  outcome.problems.push(
    isDirectory
      ? `${shown}: is a symbolic link to ${targetShown}, a folder outside the project that holds stored files the script would change or report; the script does not follow links. Run it on ${targetShown} as well`
      : `${shown}: is a symbolic link to ${targetShown}, a file outside the project that the script would change or report; the script does not follow links. Replace the link with the file, or add the format version to ${targetShown} by hand`,
  );
}

/** Walks `dir`, rewriting stored files, or, when `write` is false, only recording what it would do. A walk that only records follows no link. */
function visit(root: string, dir: string, outcome: Outcome, write = true): void {
  const entries = listDirectory(dir);
  if (typeof entries === 'string') {
    outcome.problems.push(`${relative(root, dir) || '.'}: directory cannot be read (${entries})`);
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (isWalked(entry.name)) visit(root, path, outcome, write);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      handleFile(root, path, outcome, write);
    } else if (entry.isSymbolicLink() && write) {
      handleLink(root, path, entry.name, outcome);
    }
  }
}

function main(args: readonly string[]): number {
  if (args.length > 1 || args.some((arg) => arg.startsWith('-'))) {
    process.stderr.write('Usage: node stored-files-format-version.ts [project-root]\n');
    return 1;
  }
  const root = resolve(args[0] ?? process.cwd());
  if (!existsSync(root) || !statSync(root).isDirectory()) {
    process.stderr.write(`${root}: not a directory\n`);
    return 1;
  }
  const outcome = emptyOutcome();
  visit(root, root, outcome);
  if (outcome.changed.length > 0) {
    const files = outcome.changed.length === 1 ? 'file' : 'files';
    process.stdout.write(
      `Added the format version to ${outcome.changed.length} ${files}:\n${outcome.changed.map((path) => `  ${path}\n`).join('')}`,
    );
  } else if (outcome.problems.length === 0) {
    process.stdout.write('Every stored file already has a format version; nothing changed.\n');
  } else {
    process.stdout.write('Added the format version to no file.\n');
  }
  if (outcome.dropped.length > 0) {
    process.stdout.write(
      `Removed the fields a ref file does not have, which earlier releases ignored and dropped when they wrote the ref again:\n${outcome.dropped.map((line) => `  ${line}\n`).join('')}`,
    );
  }
  if (outcome.problems.length === 0) return 0;
  process.stderr.write(
    `Left unchanged:\n${outcome.problems.map((problem) => `  ${problem}\n`).join('')}`,
  );
  return 1;
}

process.exitCode = main(process.argv.slice(2));
