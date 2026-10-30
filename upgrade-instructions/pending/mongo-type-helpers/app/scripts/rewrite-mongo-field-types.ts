#!/usr/bin/env node
/**
 * Rewrites the removed MongoDB field helpers of TypeScript contracts to `field.scalar(type.X())`: `field.objectId()` becomes `field.scalar(type.ObjectId())`, `field.scalar('mongo/string@1')` becomes `field.scalar(type.String())`, and `field.vector({ typeParams: { length: 3 } })` becomes `field.scalar(type.Vector(3))`. A call on a helpers object, such as `helpers.field.int32()`, becomes `helpers.field.scalar(helpers.type.Int32())`. Where a rewritten call reads `type` by itself, the script adds `type` to the `defineContract` callback parameter, or the declaration, that destructures `field` around the call, and otherwise to the import of `field` from `@prisma/orm-mongo/contract-builder`.
 *
 * Usage: node rewrite-mongo-field-types.ts [file or directory ...]
 *
 * The paths default to the working directory. In a directory the script reads every TypeScript and JavaScript file outside `node_modules`, `.git`, `dist` and `build`. It rewrites only files that import from a MongoDB contract builder entry, and the contract each builds does not change. It prints one line per file it changes, and one line per thing it leaves for a person: a call it cannot carry over (a codec id with no type constructor, or a vector length that is not a literal or a name), a file that already binds the name `type`, which it leaves unchanged, and a file that reads `type` where nothing gives it.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { join, relative } from 'node:path';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);
const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const BUILDER_MODULE = String.raw`(?:@prisma\/orm-mongo|@prisma\/orm-family-mongo\/contract-ts|@internal\/mongo|@internal\/mongo-contract-ts)\/contract-builder`;
const BUILDER_IMPORT = new RegExp(String.raw`from\s*['"]${BUILDER_MODULE}['"]`);
const TYPE_EXPORTING_IMPORT =
  /import\s*\{([^{}]*)\}\s*from\s*(['"])(@prisma\/orm-mongo|@internal\/mongo)\/contract-builder\2/g;

const CONSTRUCTOR_OF_HELPER: Readonly<Record<string, string>> = {
  objectId: 'ObjectId',
  string: 'String',
  double: 'Double',
  int32: 'Int32',
  bool: 'Bool',
  date: 'Date',
  int64: 'Int64',
  int64Number: 'Int64Number',
  decimal128: 'Decimal128',
  binary: 'Binary',
  json: 'Json',
  bson: 'Bson',
  vector: 'Vector',
};

const CONSTRUCTOR_OF_CODEC: Readonly<Record<string, string>> = Object.fromEntries(
  Object.entries(CONSTRUCTOR_OF_HELPER).map(([helper, typeName]) => [
    `mongo/${helper}@1`,
    typeName,
  ]),
);

const RECEIVER = String.raw`(?<![\w$.])((?:[A-Za-z_$][\w$]*\.)?)field\s*\.\s*`;
const HELPER_NAMES = Object.keys(CONSTRUCTOR_OF_HELPER).join('|');
const LENGTH = String.raw`\{\s*typeParams\s*:\s*\{\s*length(?:\s*:\s*([\w$.]+))?\s*,?\s*\}\s*,?\s*\}`;
const PLAIN_HELPER = new RegExp(String.raw`${RECEIVER}(${HELPER_NAMES})\(\s*\)`, 'g');
const VECTOR_WITH_LENGTH = new RegExp(String.raw`${RECEIVER}vector\(\s*${LENGTH}\s*\)`, 'g');
const SCALAR_OF_CODEC = new RegExp(
  String.raw`${RECEIVER}scalar\(\s*(['"])([^'"]+)\2\s*(?:,\s*${LENGTH}\s*)?\)`,
  'g',
);
const LEFT_HELPER = new RegExp(String.raw`${RECEIVER}(${HELPER_NAMES})\(`, 'g');
const LEFT_SCALAR = new RegExp(String.raw`${RECEIVER}scalar\(\s*['"]`, 'g');
const DESTRUCTURED_FIELD = /\(\s*\{([^{}()]*)\}(\s*(?::[^()=]*)?\)\s*=>)/g;
const DESTRUCTURED_FIELD_DECLARATION = /\b(const|let)\s*\{([^{}()]*)\}(\s*=)/g;
const OTHER_TYPE_BINDING =
  /\bimport\s*\{[^{}]*(?:^|[\s,{])type\s*(?=[,}])[^{}]*\}\s*from\s*['"](?!(?:@prisma\/orm-mongo|@internal\/mongo)\/contract-builder['"])|\b(?:const|let|var|function|class)\s+type\b/m;

interface FileResult {
  readonly text: string;
  readonly rewritten: number;
  readonly readsBareType: boolean;
  readonly typeUnbound: boolean;
  readonly left: readonly string[];
}

interface BoundType {
  readonly text: string;
  readonly unbound: boolean;
}

function lineOf(text: string, index: number): number {
  return text.slice(0, index).split('\n').length;
}

function typeCall(receiver: string, typeName: string, length: string | undefined): string {
  return `${receiver}field.scalar(${receiver}type.${typeName}(${length ?? ''}))`;
}

function hasMember(members: string, name: string): boolean {
  return members.split(',').some((member) => member.trim().split(/\s*[:=]/)[0] === name);
}

function hasShorthandMember(members: string, name: string): boolean {
  return members.split(',').some((member) => member.trim().split(/\s*=/)[0] === name);
}

function withMember(members: string, name: string): string {
  const trimmedEnd = members.replace(/\s*,?\s*$/, '');
  const trailing = members.slice(trimmedEnd.length).replace(',', '');
  return `${trimmedEnd}, ${name}${trailing}`;
}

const OPENING = '([{';
const CLOSING = ')]}';

/** The index of the first bracket from `start` on that closes one opened before `start`: the end of the block holding `start`. */
function blockEnd(text: string, start: number): number {
  let depth = 0;
  for (let index = start; index < text.length; index += 1) {
    const character = text.charAt(index);
    if (OPENING.includes(character)) depth += 1;
    if (CLOSING.includes(character)) depth -= 1;
    if (depth < 0) return index;
  }
  return text.length;
}

/** Where an arrow function's body ends, from the index just after its `=>`: after the bracket that closes a bracketed body, or at the end of the block holding an expression body. */
function arrowBodyEnd(text: string, start: number): number {
  const bodyStart = start + (text.slice(start).match(/^\s*/)?.[0].length ?? 0);
  return OPENING.includes(text.charAt(bodyStart))
    ? blockEnd(text, bodyStart + 1) + 1
    : blockEnd(text, bodyStart);
}

const BARE_TYPE_READ = /(?<![\w$.])type\s*\./g;

interface Edit {
  readonly start: number;
  readonly end: number;
  readonly text: string;
}

function bindType(text: string): BoundType {
  const reads = [...text.matchAll(BARE_TYPE_READ)].map((match) => match.index);
  const scopes: { readonly start: number; readonly end: number }[] = [];
  const edits: Edit[] = [];
  const bind = (
    match: RegExpExecArray | RegExpMatchArray,
    members: string,
    scopeEnd: number,
    write: (members: string) => string,
  ) => {
    const start = match.index ?? 0;
    const end = start + match[0].length;
    if (!hasShorthandMember(members, 'field')) return;
    scopes.push({ start: end, end: scopeEnd });
    if (hasMember(members, 'type')) return;
    if (!reads.some((read) => read >= end && read < scopeEnd)) return;
    edits.push({ start, end, text: write(withMember(members, 'type')) });
  };
  for (const match of text.matchAll(DESTRUCTURED_FIELD)) {
    const [, members = '', rest = ''] = match;
    const end = (match.index ?? 0) + match[0].length;
    bind(match, members, arrowBodyEnd(text, end), (bound) => `({${bound}}${rest}`);
  }
  for (const match of text.matchAll(DESTRUCTURED_FIELD_DECLARATION)) {
    const [, keyword = '', members = '', rest = ''] = match;
    const end = (match.index ?? 0) + match[0].length;
    bind(match, members, blockEnd(text, end), (bound) => `${keyword} {${bound}}${rest}`);
  }
  const unscoped = reads.some(
    (read) => !scopes.some(({ start, end }) => read >= start && read < end),
  );
  let imported = false;
  if (unscoped) {
    for (const match of text.matchAll(TYPE_EXPORTING_IMPORT)) {
      const [, members = '', quote = '', module = ''] = match;
      if (hasMember(members, 'type')) imported = true;
      if (!hasShorthandMember(members, 'field') || hasMember(members, 'type')) continue;
      imported = true;
      const start = match.index ?? 0;
      edits.push({
        start,
        end: start + match[0].length,
        text: `import {${withMember(members, 'type')}} from ${quote}${module}/contract-builder${quote}`,
      });
    }
  }
  return {
    text: edits
      .sort((a, b) => b.start - a.start)
      .reduce(
        (result, edit) => result.slice(0, edit.start) + edit.text + result.slice(edit.end),
        text,
      ),
    unbound: unscoped && !imported,
  };
}

function rewrite(text: string): FileResult {
  let rewritten = 0;
  let readsBareType = false;
  const count = (receiver: string) => {
    rewritten += 1;
    if (receiver === '') readsBareType = true;
  };
  let next = text.replace(VECTOR_WITH_LENGTH, (_whole, receiver: string, length?: string) => {
    count(receiver);
    return typeCall(receiver, 'Vector', length ?? 'length');
  });
  next = next.replace(PLAIN_HELPER, (_whole, receiver: string, helper: string) => {
    count(receiver);
    return typeCall(receiver, CONSTRUCTOR_OF_HELPER[helper] ?? helper, undefined);
  });
  next = next.replace(
    SCALAR_OF_CODEC,
    (whole, receiver: string, _quote: string, codecId: string, length?: string) => {
      const typeName = CONSTRUCTOR_OF_CODEC[codecId];
      if (typeName === undefined) return whole;
      if (length !== undefined && typeName !== 'Vector') return whole;
      count(receiver);
      return typeCall(receiver, typeName, length);
    },
  );
  let typeUnbound = false;
  if (readsBareType) {
    const bound = bindType(next);
    next = bound.text;
    typeUnbound = bound.unbound;
  }
  const left = [...next.matchAll(LEFT_HELPER), ...next.matchAll(LEFT_SCALAR)]
    .sort((a, b) => a.index - b.index)
    .map(
      (match) =>
        `line ${lineOf(next, match.index)}: ${next.slice(match.index, next.indexOf('\n', match.index)).trim()}`,
    );
  return { text: next, rewritten, readsBareType, typeUnbound, left };
}

function sourceFilesIn(directory: string): readonly string[] {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : sourceFilesIn(join(directory, entry.name));
    }
    return entry.isFile() && SOURCE_FILE.test(entry.name) ? [join(directory, entry.name)] : [];
  });
}

function filesOf(paths: readonly string[]): readonly string[] {
  return paths.flatMap((path) => (statSync(path).isDirectory() ? sourceFilesIn(path) : [path]));
}

function main(args: readonly string[]): void {
  const root = process.cwd();
  let changed = 0;
  for (const file of filesOf(args.length === 0 ? ['.'] : args)) {
    const name = relative(root, file) || file;
    const text = readFileSync(file, 'utf8');
    if (!BUILDER_IMPORT.test(text)) continue;
    const result = rewrite(text);
    if (result.readsBareType && OTHER_TYPE_BINDING.test(text)) {
      console.log(
        `${name}: already binds the name "type", which the rewrite needs for the MongoDB type helpers; left unchanged. Rename the other binding and run the script again.`,
      );
      continue;
    }
    if (result.text !== text) {
      writeFileSync(file, result.text);
      changed += 1;
      console.log(
        `${name}: rewrote ${result.rewritten} field helper call${result.rewritten === 1 ? '' : 's'}.`,
      );
    }
    if (result.typeUnbound) {
      console.log(
        `${name}: reads type outside a defineContract callback, and no import gives it; import type from @prisma/orm-mongo/contract-builder.`,
      );
    }
    for (const left of result.left) {
      console.log(`${name}: ${left}: not rewritten; write it as field.scalar(type.X(...)).`);
    }
  }
  console.log(`Changed ${changed} file${changed === 1 ? '' : 's'}.`);
}

main(process.argv.slice(2));
