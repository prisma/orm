#!/usr/bin/env node
/**
 * Gives every file Prisma stores in a project its format version. A `contract.json` (emitted next to the contract source, bundled by an extension, or a copy under `migrations/snapshots/<hash>/`) had `"schemaVersion": "1"`; it now has `"formatVersion": 1`. A `migration.json` and a ref file (`refs/<name>.json`, including an extension's `refs/head.json`) had no version; they now start with `"formatVersion": 1`. This release refuses each of these files without it.
 *
 * Usage: node stored-files-format-version.ts [project-root]
 *
 * The project root defaults to the working directory. The script walks it, skipping `node_modules`, `dist`, `build` and directories whose name starts with a dot. It recognises a contract by its content (`targetFamily`, `storage` and `schemaVersion` at the top level) in any `*.json` file, a `migration.json` by its fields and by the `ops.json` next to it, and a ref file by its fields and by a `refs` directory above it. It edits each file's text in place, so the rest of the file keeps its bytes: the version goes first, except in a contract whose top-level keys are sorted (a snapshot), where it goes in sorted position, as Prisma writes them. No hash covers the version, so no hash changes.
 *
 * It prints each file it changed. A `contract.json`, `migration.json` or ref file it cannot read or parse, a contract whose `schemaVersion` is not `"1"`, and a directory it cannot list are reported, left unchanged, and make it exit 1; it still changes every other file. A second run changes nothing.
 */
import {
  type Dirent,
  existsSync,
  readdirSync,
  readFileSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { basename, dirname, join, relative, resolve, sep } from 'node:path';

type Json = null | boolean | number | string | Json[] | JsonRecord;
interface JsonRecord {
  [key: string]: Json;
}

type StoredFileKind = 'contract' | 'migration' | 'ref';

const SKIPPED_DIRECTORIES = new Set(['node_modules', 'dist', 'build']);
const BYTE_ORDER_MARK = '﻿';
const MIGRATION_KEYS = new Set(['from', 'to', 'migrationHash', 'providedInvariants', 'createdAt']);
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

function sameMembersBesidesVersion(original: JsonRecord, rewritten: Json): boolean {
  if (!isRecord(rewritten) || rewritten['formatVersion'] !== 1 || 'schemaVersion' in rewritten)
    return false;
  const { schemaVersion: _, ...rest } = original;
  const { formatVersion: __, ...rewrittenRest } = rewritten;
  return JSON.stringify(rest) === JSON.stringify(rewrittenRest);
}

function isContract(value: JsonRecord): boolean {
  return typeof value['targetFamily'] === 'string' && isRecord(value['storage']);
}

function isMigrationMetadata(value: JsonRecord): boolean {
  return (
    Object.keys(value).every((key) => key === 'formatVersion' || MIGRATION_KEYS.has(key)) &&
    (value['from'] === null || typeof value['from'] === 'string') &&
    typeof value['to'] === 'string' &&
    typeof value['migrationHash'] === 'string'
  );
}

function isRef(value: JsonRecord): boolean {
  return (
    Object.keys(value).every((key) => key === 'formatVersion' || REF_KEYS.has(key)) &&
    typeof value['hash'] === 'string' &&
    isStringArray(value['invariants'])
  );
}

/** The kind of stored file `path` is by its name and place, before its content is read. */
function expectedKind(root: string, path: string): StoredFileKind | undefined {
  const name = basename(path);
  if (name === 'migration.json' && existsSync(join(dirname(path), 'ops.json'))) return 'migration';
  if (relative(root, dirname(path)).split(sep).includes('refs')) return 'ref';
  if (name === 'contract.json') return 'contract';
  return undefined;
}

type Rewrite =
  | { readonly kind: 'unchanged' }
  | { readonly kind: 'rewritten'; readonly text: string }
  | { readonly kind: 'problem'; readonly reason: string };

function rewrite(text: string, value: JsonRecord, expected: StoredFileKind | undefined): Rewrite {
  if ('formatVersion' in value) return { kind: 'unchanged' };
  if (expected === 'migration' && isMigrationMetadata(value))
    return { kind: 'rewritten', text: withFormatVersion(text, 'first') };
  if (expected === 'ref' && isRef(value))
    return { kind: 'rewritten', text: withFormatVersion(text, 'first') };
  if (!isContract(value) || !('schemaVersion' in value)) return { kind: 'unchanged' };
  if (value['schemaVersion'] !== '1')
    return {
      kind: 'problem',
      reason: `its "schemaVersion" is ${JSON.stringify(value['schemaVersion'])}, which no release of Prisma wrote`,
    };
  return {
    kind: 'rewritten',
    text: withFormatVersion(withoutMember(text, 'schemaVersion'), 'sorted-when-sorted'),
  };
}

function handleFile(root: string, path: string, outcome: Outcome): void {
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
  if (!isRecord(value)) return;
  const result = rewrite(text, value, expected);
  if (result.kind === 'unchanged') return;
  if (result.kind === 'problem') {
    outcome.problems.push(`${shown}: ${result.reason}`);
    return;
  }
  if (!sameMembersBesidesVersion(value, JSON.parse(result.text))) {
    outcome.problems.push(`${shown}: could not be rewritten without changing other content`);
    return;
  }
  try {
    writeFileSync(path, bom + result.text);
    outcome.changed.push(shown);
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

function visit(root: string, dir: string, outcome: Outcome): void {
  const entries = listDirectory(dir);
  if (typeof entries === 'string') {
    outcome.problems.push(`${relative(root, dir) || '.'}: directory cannot be read (${entries})`);
    return;
  }
  for (const entry of entries) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name) && !entry.name.startsWith('.'))
        visit(root, path, outcome);
    } else if (entry.isFile() && entry.name.endsWith('.json')) {
      handleFile(root, path, outcome);
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
  const outcome: Outcome = { changed: [], problems: [] };
  visit(root, root, outcome);
  if (outcome.changed.length === 0) {
    process.stdout.write('Every stored file already has a format version; nothing changed.\n');
  } else {
    const files = outcome.changed.length === 1 ? 'file' : 'files';
    process.stdout.write(
      `Added the format version to ${outcome.changed.length} ${files}:\n${outcome.changed.map((path) => `  ${path}\n`).join('')}`,
    );
  }
  if (outcome.problems.length === 0) return 0;
  process.stderr.write(
    `Left unchanged:\n${outcome.problems.map((problem) => `  ${problem}\n`).join('')}`,
  );
  return 1;
}

process.exitCode = main(process.argv.slice(2));
