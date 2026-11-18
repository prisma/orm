#!/usr/bin/env node
// Adds `storage.fields` to every MongoDB contract written before models recorded the stored name of each field.
// Each field keeps its name and is recorded as stored under that name, which is what the old contract meant.
// Usage: node mongo-field-storage-names.ts [<project root>]

import { readdirSync, readFileSync, renameSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);
const TEMPORARY_SUFFIX = '.mongo-field-storage-names-tmp';

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

function modelsOf(contract: JsonObject): [string, JsonObject][] {
  const domain = contract['domain'];
  if (!isObject(domain) || !isObject(domain['namespaces'])) return [];
  return Object.values(domain['namespaces']).flatMap((namespace) =>
    isObject(namespace) && isObject(namespace['models'])
      ? Object.entries(namespace['models']).filter((entry): entry is [string, JsonObject] =>
          isObject(entry[1]),
        )
      : [],
  );
}

function needsStorageFields(model: JsonObject): boolean {
  return isObject(model['fields']) && isObject(model['storage']) && !('fields' in model['storage']);
}

function withStorageFields(model: JsonObject): JsonObject {
  const storage = model['storage'];
  const fields = model['fields'];
  if (!isObject(storage) || !isObject(fields)) return model;
  const storageFields = Object.fromEntries(
    Object.keys(fields).map((name) => [name, { field: name }]),
  );
  const rewritten: JsonObject = {};
  if ('collection' in storage) rewritten['collection'] = storage['collection'];
  rewritten['fields'] = storageFields;
  for (const [key, value] of Object.entries(storage)) {
    if (key !== 'collection') rewritten[key] = value;
  }
  return { ...model, storage: rewritten };
}

function rewriteContract(contract: JsonObject, modelNames: ReadonlySet<string>): JsonObject {
  const domain = contract['domain'];
  if (!isObject(domain) || !isObject(domain['namespaces'])) return contract;
  const namespaces = Object.fromEntries(
    Object.entries(domain['namespaces']).map(([id, namespace]) => {
      if (!isObject(namespace) || !isObject(namespace['models'])) return [id, namespace];
      const models = Object.fromEntries(
        Object.entries(namespace['models']).map(([name, model]) => [
          name,
          isObject(model) && modelNames.has(name) ? withStorageFields(model) : model,
        ]),
      );
      return [id, { ...namespace, models }];
    }),
  );
  return { ...contract, domain: { ...domain, namespaces } };
}

function serializeLike(original: string, value: JsonObject): string {
  const trailingNewline = original.endsWith('\n') ? '\n' : '';
  const singleLine = !original.trimEnd().includes('\n');
  return `${singleLine ? JSON.stringify(value) : JSON.stringify(value, null, 2)}${trailingNewline}`;
}

function matchingBrace(text: string, open: number): number {
  let depth = 0;
  for (let index = open; index < text.length; index++) {
    const char = text[index];
    if (char === "'" || char === '"' || char === '`') {
      index = text.indexOf(char, index + 1);
      if (index === -1) return -1;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') {
      depth--;
      if (depth === 0) return index;
    }
  }
  return -1;
}

function typeKey(name: string, quote: string): string {
  return /^[A-Za-z_$][\w$]*$/.test(name) ? name : `${quote}${name}${quote}`;
}

function storageFieldsType(fieldNames: readonly string[], quote: string): string {
  if (fieldNames.length === 0) return 'readonly fields: Record<string, never>';
  const entries = fieldNames.map(
    (name) => `readonly ${typeKey(name, quote)}: { readonly field: ${quote}${name}${quote} }`,
  );
  return `readonly fields: { ${entries.join('; ')} }`;
}

const STORAGE_KEY = /readonly storage:\s*/g;

/** How many braces are open at `end` in `text`, outside string literals. */
function braceDepth(text: string, end: number): number {
  let depth = 0;
  for (let index = 0; index < end; index++) {
    const char = text[index];
    if (char === "'" || char === '"' || char === '`') {
      const close = text.indexOf(char, index + 1);
      if (close === -1 || close >= end) return depth;
      index = close;
      continue;
    }
    if (char === '{') depth++;
    if (char === '}') depth--;
  }
  return depth;
}

/** The model's `readonly storage: ...` type with `readonly fields` added, or undefined when the model's block is not found. */
function rewriteModelType(
  declarations: string,
  modelName: string,
  fieldNames: readonly string[],
): string | undefined {
  const quote = declarations.includes("readonly collection: '") ? "'" : '"';
  const header = new RegExp(`readonly (?:${modelName}|'${modelName}'|"${modelName}"):\\s*\\{`, 'g');
  for (const match of declarations.matchAll(header)) {
    const open = match.index + match[0].length - 1;
    const close = matchingBrace(declarations, open);
    if (close === -1) continue;
    const block = declarations.slice(open, close + 1);
    STORAGE_KEY.lastIndex = 0;
    for (const storageMatch of block.matchAll(STORAGE_KEY)) {
      if (braceDepth(block, storageMatch.index) !== 1) continue;
      const typeStart = open + storageMatch.index + storageMatch[0].length;
      const fields = storageFieldsType(fieldNames, quote);
      if (declarations.startsWith('Record<string, never>', typeStart)) {
        return `${declarations.slice(0, typeStart)}{ ${fields} }${declarations.slice(typeStart + 'Record<string, never>'.length)}`;
      }
      if (declarations[typeStart] !== '{') continue;
      const typeEnd = matchingBrace(declarations, typeStart);
      const inner = declarations
        .slice(typeStart + 1, typeEnd)
        .trim()
        .replace(/;$/, '');
      const members = inner.length === 0 ? [] : [inner];
      const collectionEnd = inner.match(/^readonly collection:\s*(['"])[^'"]*\1/)?.[0];
      const rewritten =
        collectionEnd === undefined
          ? [fields, ...members]
          : [collectionEnd, fields, inner.slice(collectionEnd.length).replace(/^;\s*/, '')].filter(
              (member) => member.length > 0,
            );
      return `${declarations.slice(0, typeStart)}{ ${rewritten.join('; ')} }${declarations.slice(typeEnd + 1)}`;
    }
  }
  return undefined;
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
  let mongoContracts = 0;
  for (const path of files.sort()) {
    let contract: unknown;
    try {
      contract = JSON.parse(readFileSync(path, 'utf8'));
    } catch {
      continue;
    }
    if (!isObject(contract) || contract['targetFamily'] !== 'mongo') continue;
    mongoContracts++;
    const oldModels = modelsOf(contract).filter(([, model]) => needsStorageFields(model));
    if (oldModels.length === 0) continue;
    const original = readFileSync(path, 'utf8');
    const modelNames = new Set(oldModels.map(([name]) => name));
    writeFile(path, serializeLike(original, rewriteContract(contract, modelNames)));
    changed.push(relative(root, path));

    const declarationsPath = `${path.slice(0, -'.json'.length)}.d.ts`;
    let declarations: string;
    try {
      declarations = readFileSync(declarationsPath, 'utf8');
    } catch {
      continue;
    }
    let rewritten = declarations;
    for (const [name, model] of oldModels) {
      const fields = isObject(model['fields']) ? Object.keys(model['fields']) : [];
      const next = rewriteModelType(rewritten, name, fields);
      if (next === undefined) {
        warnings.push(
          `${relative(root, declarationsPath)}: no storage type found for model ${name}; add readonly fields to it by hand`,
        );
        continue;
      }
      rewritten = next;
    }
    if (rewritten !== declarations) {
      writeFile(declarationsPath, rewritten);
      changed.push(relative(root, declarationsPath));
    }
  }

  for (const warning of warnings) process.stderr.write(`${warning}\n`);
  if (mongoContracts === 0) {
    process.stdout.write('No MongoDB contract found under the project root; nothing changed.\n');
    return 0;
  }
  if (changed.length === 0) {
    process.stdout.write(
      'Every MongoDB contract already records its stored names; nothing changed.\n',
    );
    return 0;
  }
  for (const path of changed) process.stdout.write(`${path}\n`);
  process.stdout.write(`Rewrote ${changed.length} file${changed.length === 1 ? '' : 's'}.\n`);
  return warnings.length > 0 ? 1 : 0;
}

process.exitCode = main();
