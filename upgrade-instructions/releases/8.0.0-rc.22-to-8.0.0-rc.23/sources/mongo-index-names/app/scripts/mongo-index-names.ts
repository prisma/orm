#!/usr/bin/env node
// Names every index of a MongoDB contract written before contracts recorded index names.
// A contract snapshot's index takes the name its own project's emitted contract gives the index with the same
// collection, keys and options. A snapshot's project is the nearest folder, going up from the folder that holds
// its `migrations` folder, that holds an emitted contract (a MongoDB contract outside every `snapshots` folder).
// The walk stops at the first folder with a `package.json`, the project root, so no name comes from another project.
// When no emitted contract of the project has the index, or two of them name it differently, the index gets the
// name earlier releases gave it in the database, its keys and directions such as `email_1`, and the script says so.
// Usage: node mongo-index-names.ts [<root>]

import { existsSync, readdirSync, readFileSync, renameSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);
const TEMPORARY_SUFFIX = '.mongo-index-names-tmp';

type JsonObject = { [key: string]: unknown };

function isObject(value: unknown): value is JsonObject {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function walk(dir: string, found: string[], links: string[]): void {
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (!SKIPPED_DIRECTORIES.has(entry.name)) walk(path, found, links);
      continue;
    }
    if (entry.isSymbolicLink()) {
      links.push(path);
      continue;
    }
    if (!entry.isFile()) continue;
    if (entry.name.endsWith(TEMPORARY_SUFFIX)) {
      rmSync(path);
      continue;
    }
    if (entry.name.endsWith('.json')) found.push(path);
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

/** An index's collection, keys and options, as a string: what the database tells two indexes apart by. */
function contentKey(collection: string, index: JsonObject): string {
  const { name: _name, kind: _kind, ...content } = index;
  return canonicalJson([collection, content]);
}

function canonicalJson(value: unknown): string {
  if (Array.isArray(value)) return `[${value.map(canonicalJson).join(',')}]`;
  if (!isObject(value)) return JSON.stringify(value);
  const entries = Object.keys(value)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`);
  return `{${entries.join(',')}}`;
}

/** Each index of a contract, with the collection it belongs to. */
function indexesOf(
  value: unknown,
  found: { readonly collection: string; readonly index: JsonObject }[],
  collection = '',
): void {
  if (Array.isArray(value)) {
    for (const item of value) indexesOf(item, found, collection);
    return;
  }
  if (!isObject(value)) return;
  if (value['kind'] === 'mongo-index') {
    found.push({ collection, index: value });
    return;
  }
  for (const [key, item] of Object.entries(value)) {
    if (key === 'collection' && isObject(item)) {
      for (const [name, entry] of Object.entries(item)) indexesOf(entry, found, name);
    } else {
      indexesOf(item, found, collection);
    }
  }
}

/** The names emitted contracts give indexes, by collection and content; each name is listed once. */
type EmittedNames = Map<string, readonly string[]>;

function recordEmittedNames(contract: JsonObject, emitted: EmittedNames): void {
  const found: { readonly collection: string; readonly index: JsonObject }[] = [];
  indexesOf(contract, found);
  for (const { collection, index } of found) {
    const name = index['name'];
    if (typeof name !== 'string') continue;
    const key = contentKey(collection, index);
    const names = emitted.get(key) ?? [];
    if (!names.includes(name)) emitted.set(key, [...names, name]);
  }
}

type NameFor = (collection: string, index: JsonObject) => string;

/** The value with each unnamed index named, and the names given, in the order the JSON lists the indexes. */
function nameIndexes(value: unknown, names: string[], nameFor: NameFor, collection = ''): unknown {
  if (Array.isArray(value))
    return value.map((item) => nameIndexes(item, names, nameFor, collection));
  if (!isObject(value)) return value;
  if (isUnnamedIndex(value)) {
    const name = nameFor(collection, value);
    names.push(name);
    return named(value, name);
  }
  return Object.fromEntries(
    Object.entries(value).map(([key, item]) => [
      key,
      key === 'collection' && isObject(item)
        ? Object.fromEntries(
            Object.entries(item).map(([name, entry]) => [
              name,
              nameIndexes(entry, names, nameFor, name),
            ]),
          )
        : nameIndexes(item, names, nameFor, collection),
    ]),
  );
}

function hasUnnamedIndex(contract: JsonObject): boolean {
  const found: { readonly collection: string; readonly index: JsonObject }[] = [];
  indexesOf(contract, found);
  return found.some(({ index }) => !('name' in index));
}

function sortKeys(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(sortKeys);
  if (!isObject(value)) return value;
  return Object.fromEntries(
    Object.keys(value)
      .sort()
      .map((key) => [key, sortKeys(value[key])]),
  );
}

/** The contract in the layout it had: one line with sorted keys, as snapshots are written, or indented by two. */
function serializeLike(original: string, value: unknown): string {
  const trailingNewline = original.endsWith('\n') ? '\n' : '';
  const singleLine = !original.trimEnd().includes('\n');
  return `${singleLine ? JSON.stringify(sortKeys(value)) : JSON.stringify(value, null, 2)}${trailingNewline}`;
}

const INDEX_KIND = /readonly kind: (['"])mongo-index\1;?(\n[ \t]*)?/g;

/** The declarations with `readonly name` added after each index's `readonly kind`, or undefined when their indexes are not the JSON's. */
function nameIndexTypes(declarations: string, names: readonly string[]): string | undefined {
  const matches = [...declarations.matchAll(INDEX_KIND)];
  if (matches.length !== names.length) return undefined;
  let rewritten = '';
  let from = 0;
  matches.forEach((match, position) => {
    const quote = match[1];
    const name = `readonly name: ${quote}${names[position]}${quote}`;
    const lineBreak = match[2];
    const kindEnd = match.index + match[0].length - (lineBreak?.length ?? 0);
    if (lineBreak === undefined) {
      const kind = declarations.slice(match.index, kindEnd).replace(/;$/, '');
      rewritten += `${declarations.slice(from, match.index)}${kind}; ${name}${match[0].endsWith(';') ? ';' : ''}`;
    } else {
      const indent = declarations.slice(
        declarations.lastIndexOf('\n', match.index) + 1,
        match.index,
      );
      rewritten += `${declarations.slice(from, kindEnd)}\n${indent}${name};`;
    }
    from = kindEnd;
  });
  return rewritten + declarations.slice(from);
}

function writeFile(path: string, content: string): void {
  const temporary = `${path}${TEMPORARY_SUFFIX}`;
  writeFileSync(temporary, content);
  renameSync(temporary, path);
}

function isSnapshot(path: string): boolean {
  return path.split(sep).includes('snapshots');
}

/** The folder a snapshot's project is in: the one that holds the `migrations` folder its `snapshots` folder is in. */
function migrationsParentOf(snapshotPath: string): string {
  const parts = snapshotPath.split(sep);
  const snapshots = parts.lastIndexOf('snapshots');
  return parts.slice(0, Math.max(snapshots - 1, 1)).join(sep) || sep;
}

function keysText(index: JsonObject): string {
  const keys = Array.isArray(index['keys']) ? index['keys'] : [];
  return keys
    .map((key) => (isObject(key) ? `${String(key['field'])}: ${String(key['direction'])}` : ''))
    .join(', ');
}

function main(): number {
  const root = resolve(process.argv[2] ?? '.');
  const files: string[] = [];
  const links: string[] = [];
  walk(root, files, links);
  const contracts: {
    readonly path: string;
    readonly original: string;
    readonly contract: JsonObject;
  }[] = [];
  for (const path of files.sort()) {
    const original = readFileSync(path, 'utf8');
    let contract: unknown;
    try {
      contract = JSON.parse(original);
    } catch {
      continue;
    }
    if (isObject(contract) && contract['targetFamily'] === 'mongo') {
      contracts.push({ path, original, contract });
    }
  }
  const emittedContracts = contracts.filter(
    ({ path, contract }) => !isSnapshot(path) && !hasUnnamedIndex(contract),
  );

  /** The names the emitted contracts of the nearest folder up from `start` that holds any give their indexes, going no higher than the first folder with a `package.json`. */
  const projectNames = (
    start: string,
  ): { readonly folder: string; readonly names: EmittedNames } => {
    for (let folder = start; ; folder = dirname(folder)) {
      const inFolder = emittedContracts.filter(({ path }) => path.startsWith(`${folder}${sep}`));
      const projectRoot = existsSync(join(folder, 'package.json'));
      if (inFolder.length > 0 || projectRoot || folder === root || folder === dirname(folder)) {
        const names: EmittedNames = new Map();
        for (const { contract } of inFolder) recordEmittedNames(contract, names);
        return { folder, names };
      }
    }
  };

  const changed: string[] = [];
  const notes: string[] = [];
  const warnings: string[] = links.map(
    (link) =>
      `${relative(root, link)}: is a symbolic link, so the script did not read it; if it holds migration snapshots, run the script on the folder it points to.`,
  );
  for (const { path, original, contract } of contracts) {
    const project = projectNames(isSnapshot(path) ? migrationsParentOf(path) : dirname(path));
    const nameFor: NameFor = (collection, index) => {
      const fallback = defaultName(index['keys']);
      const emitted = project.names.get(contentKey(collection, index)) ?? [];
      const [only] = emitted;
      if (emitted.length === 1 && only !== undefined) return only;
      const where = `${relative(root, path)}: the index on { ${keysText(index)} } in collection "${collection}"`;
      notes.push(
        emitted.length === 0
          ? `${where} is in no emitted contract under ${relative(root, project.folder) || '.'}; named ${fallback} after its keys.`
          : `${where} is named ${emitted.join(' and ')} by the emitted contracts under ${relative(root, project.folder) || '.'}; named ${fallback} after its keys.`,
      );
      return fallback;
    };
    const names: string[] = [];
    const rewritten = nameIndexes(contract, names, nameFor);
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
  for (const note of notes) console.log(note);
  for (const warning of warnings) console.error(warning);
  console.log(
    changed.length === 0
      ? 'Nothing to change.'
      : `Rewrote ${changed.length} file${changed.length === 1 ? '' : 's'}.`,
  );
  return warnings.length === 0 ? 0 : 1;
}

process.exitCode = main();
