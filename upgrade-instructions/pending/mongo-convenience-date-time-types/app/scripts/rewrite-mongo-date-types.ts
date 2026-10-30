#!/usr/bin/env node
/**
 * Rewrites `Date` to `DateTime` in MongoDB schemas and `type.Date()` to `type.DateTime()` in MongoDB TypeScript contracts. On MongoDB, `Date` was an instant read as a JavaScript `Date`; it is now a calendar date, and `DateTime` with no arguments is what `Date` was, so the contract does not change.
 *
 * A `.prisma` file is a MongoDB schema when the nearest `prisma.config.*` at or above its folder imports `@prisma/orm-mongo`, or when such a config names it as its `contract`. A schema with a `datasource` block, which is a Prisma 6 or Prisma 7 schema, and one a config reads with `prisma6Schema(...)` are left alone. A TypeScript or JavaScript file is a MongoDB contract when it imports a MongoDB contract builder entry; in it, a call of `Date` on `type`, or on a name `type` is imported or destructured as, becomes `DateTime`.
 *
 * A schema that declares a model, type or enum named `Date` is left as it is. The script prints one line per file it changes, and one line per place it leaves for a person: a schema that declares its own `Date`, and a call of `Date` on a name it cannot tell is the `type` of a MongoDB contract builder.
 *
 * Usage: node rewrite-mongo-date-types.ts [file or directory ...]
 *
 * The paths default to the working directory, which is also where the script looks for `prisma.config.*` files. In a directory it reads every file outside `node_modules`, `.git`, `dist` and `build`.
 */
import { readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';

const SKIPPED_DIRECTORIES = new Set(['node_modules', '.git', 'dist', 'build']);
const CONFIG_FILE = /^prisma\.config\.(?:[cm]?ts|[cm]?js)$/;
const SOURCE_FILE = /\.(?:[cm]?ts|tsx|[cm]?js|jsx)$/;
const MONGO_CONFIG_IMPORT = /['"]@prisma\/orm-mongo(?:\/[\w/-]*)?['"]/;
const CONTRACT_PATH = /\bcontract\s*:\s*['"]([^'"]+\.prisma)['"]/g;
const PRISMA6_SCHEMA_PATH = /\bprisma6Schema\s*\(\s*['"]([^'"]+)['"]/g;
const DATASOURCE_BLOCK = /(?:^|\n)[ \t]*datasource[ \t]+\w+[ \t]*\{/;
const FIELD_OR_ALIAS_OF_TYPE_DATE = /^([ \t]+[A-Za-z_]\w*[ \t]+(?:=[ \t]*)?)Date(?![\w$])/gm;
const MONGO_BUILDER_IMPORT =
  /['"](?:@prisma\/orm-mongo|@prisma\/orm-family-mongo\/contract-ts|@internal\/mongo|@internal\/mongo-contract-ts)\/contract-builder['"]/;
const TYPE_ALIASES = /(?<![\w$])type\s*(?:as|:)\s*([A-Za-z_$][\w$]*)/g;
const DECLARES_DATE = /(?:^|\n)[ \t]*(?:model|type|enum|view)[ \t]+Date[ \t]*\{/;
const OTHER_DATE_CALL = /(?<![\w$])[A-Za-z_$][\w$]*(?:\s*\.\s*[A-Za-z_$][\w$]*)*\s*\.\s*Date\s*\(/g;

function filesUnder(path: string): string[] {
  if (!statSync(path).isDirectory()) return [path];
  return readdirSync(path, { withFileTypes: true }).flatMap((entry) => {
    if (entry.isDirectory()) {
      return SKIPPED_DIRECTORIES.has(entry.name) ? [] : filesUnder(join(path, entry.name));
    }
    return entry.isFile() ? [join(path, entry.name)] : [];
  });
}

interface Config {
  readonly dir: string;
  readonly mongo: boolean;
}

function readConfigs(root: string): {
  readonly configs: readonly Config[];
  readonly named: ReadonlySet<string>;
  readonly prisma6: ReadonlySet<string>;
} {
  const configs: Config[] = [];
  const named = new Set<string>();
  const prisma6 = new Set<string>();
  for (const file of filesUnder(root)) {
    if (!CONFIG_FILE.test(file.split(sep).at(-1) ?? '')) continue;
    const text = readFileSync(file, 'utf8');
    const dir = dirname(file);
    const mongo = MONGO_CONFIG_IMPORT.test(text);
    configs.push({ dir, mongo });
    if (!mongo) continue;
    for (const [, path = ''] of text.matchAll(CONTRACT_PATH)) named.add(resolve(dir, path));
    for (const [, path = ''] of text.matchAll(PRISMA6_SCHEMA_PATH)) prisma6.add(resolve(dir, path));
  }
  return { configs, named, prisma6 };
}

function isInside(file: string, dir: string): boolean {
  return file.startsWith(`${dir}${sep}`);
}

function isMongoSchema(file: string, configs: ReturnType<typeof readConfigs>): boolean {
  if (configs.prisma6.has(file)) return false;
  if (configs.named.has(file)) return true;
  const nearest = configs.configs
    .filter((config) => isInside(file, config.dir))
    .sort((a, b) => b.dir.length - a.dir.length)[0];
  return nearest?.mongo === true;
}

/** What a rewrite did: the new text, how many places it rewrote, and the lines it left for a person, each with the reason. */
interface Rewrite {
  readonly text: string;
  readonly count: number;
  readonly left: readonly string[];
}

const UNCHANGED = (text: string): Rewrite => ({ text, count: 0, left: [] });

function lineOf(text: string, offset: number): number {
  return text.slice(0, offset).split('\n').length;
}

function rewriteSchema(text: string): Rewrite {
  if (DATASOURCE_BLOCK.test(text)) return UNCHANGED(text);
  const declared = DECLARES_DATE.exec(text);
  if (declared !== null) {
    const count = [...text.matchAll(FIELD_OR_ALIAS_OF_TYPE_DATE)].length;
    return count === 0
      ? UNCHANGED(text)
      : {
          text,
          count: 0,
          left: [
            `line ${lineOf(text, declared.index + declared[0].indexOf('Date'))}: the schema declares its own Date, so the script cannot tell which fields typed Date are MongoDB's date; write each of those as DateTime`,
          ],
        };
  }
  let count = 0;
  const rewritten = text.replace(FIELD_OR_ALIAS_OF_TYPE_DATE, (_whole, before: string) => {
    count += 1;
    return `${before}DateTime`;
  });
  return { text: rewritten, count, left: [] };
}

function rewriteContract(text: string): Rewrite {
  if (!MONGO_BUILDER_IMPORT.test(text)) return UNCHANGED(text);
  const receivers = new Set(['type', ...[...text.matchAll(TYPE_ALIASES)].map(([, name]) => name)]);
  const call = new RegExp(
    `(?<![\\w$])((?:${[...receivers].join('|').replaceAll('$', '\\$')})\\s*\\.\\s*)Date(\\s*\\()`,
    'g',
  );
  let count = 0;
  const rewritten = text.replace(call, (_whole, before: string, after: string) => {
    count += 1;
    return `${before}DateTime${after}`;
  });
  const left = [...rewritten.matchAll(OTHER_DATE_CALL)].map(
    (match) =>
      `line ${lineOf(rewritten, match.index)}: ${match[0].trim()}): the script cannot tell this is the type of a MongoDB contract builder; if it is, write DateTime`,
  );
  return { text: rewritten, count, left };
}

const root = process.cwd();
const configs = readConfigs(root);
const paths = process.argv.slice(2);
const files = (paths.length === 0 ? [root] : paths.map((path) => resolve(root, path))).flatMap(
  filesUnder,
);

let changed = 0;
for (const file of [...new Set(files)].sort()) {
  const isSchema = file.endsWith('.prisma');
  if (!isSchema && !SOURCE_FILE.test(file)) continue;
  if (isSchema && !isMongoSchema(file, configs)) continue;
  const text = readFileSync(file, 'utf8');
  const result = isSchema ? rewriteSchema(text) : rewriteContract(text);
  const name = relative(root, file);
  if (result.count > 0) {
    writeFileSync(file, result.text);
    changed += 1;
    const what = isSchema ? 'field type' : 'type.Date() call';
    console.log(`${name}: rewrote ${result.count} ${what}${result.count === 1 ? '' : 's'}.`);
  }
  for (const line of result.left) console.log(`${name}: ${line}.`);
}
console.log(`Changed ${changed} file${changed === 1 ? '' : 's'}.`);
