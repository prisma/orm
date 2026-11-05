#!/usr/bin/env node
// Names every index of a MongoDB contract written before contracts recorded index names.
// Each index gets the name MongoDB gave it when earlier releases created it: its keys and directions, such as `email_1`.
// Usage: node mongo-index-names.ts [<project root>]

import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);
const TEMPORARY_SUFFIX = '.mongo-index-names-tmp';

type JsonObject = { [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(dir: string, found: string[]): void {
  for (const entry of readdirSync(dir)) {
    const path = join(dir, entry);
    const stats = statSync(path);
    if (stats.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry)) walk(path, found);
      continue;
    }
    if (entry.endsWith(TEMPORARY_SUFFIX)) {
      rmSync(path);
      continue;
    }
    if (entry.endsWith('.json')) found.push(path);
  }
}

function isUnnamedIndex(value: unknown): value is JsonObject {
  return (
    isObject(value) &&
    value['kind'] === 'mongo-index' &&
    Array.isArray(value['keys']) &&
    !('name' in value)
  );
}

function defaultName(keys: unknown): string {
  return (Array.isArray(keys) ? keys : [])
    .map((key) => (isObject(key) ? `${String(key['field'])}_${String(key['direction'])}` : ''))
    .join('_');
}

/** The index with its name, its keys in sorted order as `contract emit` writes them. */
function named(index: JsonObject, name: string): JsonObject {
  const entries = [...Object.entries(index), ['name', name] as const];
  return Object.fromEntries(entries.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

/** The value with each unnamed index named, and the names given, in the order the JSON lists the indexes. */
function nameIndexes(value: unknown, names: string[]): unknown {
  if (Array.isArray(value)) return value.map((item) => nameIndexes(item, names));
  if (!isObject(value)) return value;
  if (isUnnamedIndex(value)) {
    const name = defaultName(value['keys']);
    names.push(name);
    return named(value, name);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [key, nameIndexes(item, names)]),
  );
}

function serializeLike(original: string, value: unknown): string {
  const trailingNewline = original.endsWith('\n') ? '\n' : '';
  const singleLine = !original.trimEnd().includes('\n');
  return `${singleLine ? JSON.stringify(value) : JSON.stringify(value, null, 2)}${trailingNewline}`;
}

const INDEX_KIND = /readonly kind: (['"])mongo-index\1/g;

/** The declarations with `readonly name` added after each index's `readonly kind`, or undefined when their indexes are not the JSON's. */
function nameIndexTypes(declarations: string, names: readonly string[]): string | undefined {
  const matches = [...declarations.matchAll(INDEX_KIND)];
  if (matches.length !== names.length) return undefined;
  let rewritten = '';
  let from = 0;
  matches.forEach((match, position) => {
    const end = match.index + match[0].length;
    const quote = match[1];
    rewritten += `${declarations.slice(from, end)}; readonly name: ${quote}${names[position]}${quote}`;
    from = end;
  });
  return rewritten + declarations.slice(from);
}

function writeFile(path: string, content: string): void {
  const temporary = `${path}${TEMPORARY_SUFFIX}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function main(): number {
  const root = resolve(process.argv[2] ?? '.');
  const files: string[] = [];
  walk(root, files);
  const changed: string[] = [];
  const warnings: string[] = [];
  for (const path of files.sort()) {
    const original = readFileSync(path, 'utf8');
    let contract: unknown;
    try {
      contract = JSON.parse(original);
    } catch {
      continue;
    }
    if (!isObject(contract) || contract['targetFamily'] !== 'mongo') continue;
    const names: string[] = [];
    const rewritten = nameIndexes(contract, names);
    if (names.length === 0) continue;
    writeFile(path, serializeLike(original, rewritten));
    changed.push(path);

    const declarationsPath = path.replace(/\.json$/, '.d.ts');
    let declarations: string;
    try {
      declarations = readFileSync(declarationsPath, 'utf8');
    } catch {
      continue;
    }
    const namedDeclarations = nameIndexTypes(declarations, names);
    if (namedDeclarations === undefined) {
      warnings.push(
        `${relative(root, declarationsPath)}: could not match its index types with ${relative(root, path)}. Add readonly name: '<name>' to each index type by hand.`,
      );
      continue;
    }
    writeFile(declarationsPath, namedDeclarations);
    changed.push(declarationsPath);
  }

  for (const path of changed) console.log(relative(root, path));
  for (const warning of warnings) console.error(warning);
  console.log(
    changed.length === 0
      ? 'Nothing to change.'
      : `Rewrote ${changed.length} file${changed.length === 1 ? '' : 's'}.`,
  );
  return warnings.length === 0 ? 0 : 1;
}

process.exitCode = main();
