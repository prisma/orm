#!/usr/bin/env node
/**
 * Rewrites `Date` to `DateTime` in MongoDB schemas and `type.Date()` to `type.DateTime()` in MongoDB TypeScript contracts. On MongoDB, `Date` was an instant read as a JavaScript `Date`; it is now a calendar date, and `DateTime` with no arguments is what `Date` was, so the contract does not change.
 *
 * A `.prisma` file is a MongoDB schema when the nearest `prisma.config.*` at or above its folder imports `@prisma/orm-mongo`, or when such a config names it as its `contract`. A schema with a `datasource` block, which is a Prisma 6 or Prisma 7 schema, and one a config reads with `prisma6Schema(...)` are left alone. A TypeScript or JavaScript file is a MongoDB contract when it imports a MongoDB contract builder entry; in it, a call of `Date` on `type`, or on a name `type` is imported or destructured as, becomes `DateTime`.
 *
 * Usage: node rewrite-mongo-date-types.ts [file or directory ...]
 *
 * The paths default to the working directory, which is also where the script looks for `prisma.config.*` files. In a directory it reads every file outside `node_modules`, `.git`, `dist` and `build`. It prints one line per file it changes.
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

function rewriteSchema(text: string): { readonly text: string; readonly count: number } {
  if (DATASOURCE_BLOCK.test(text)) return { text, count: 0 };
  let count = 0;
  const rewritten = text.replace(FIELD_OR_ALIAS_OF_TYPE_DATE, (_whole, before: string) => {
    count += 1;
    return `${before}DateTime`;
  });
  return { text: rewritten, count };
}

function rewriteContract(text: string): { readonly text: string; readonly count: number } {
  if (!MONGO_BUILDER_IMPORT.test(text)) return { text, count: 0 };
  const receivers = new Set(['type', ...[...text.matchAll(TYPE_ALIASES)].map(([, name]) => name)]);
  const call = new RegExp(
    `(?<![\\w$.])((?:${[...receivers].join('|').replaceAll('$', '\\$')})\\s*\\.\\s*)Date(\\s*\\()`,
    'g',
  );
  let count = 0;
  const rewritten = text.replace(call, (_whole, before: string, after: string) => {
    count += 1;
    return `${before}DateTime${after}`;
  });
  return { text: rewritten, count };
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
  if (result.count === 0) continue;
  writeFileSync(file, result.text);
  changed += 1;
  const what = isSchema ? 'field type' : 'type.Date() call';
  console.log(
    `${relative(root, file)}: rewrote ${result.count} ${what}${result.count === 1 ? '' : 's'}.`,
  );
}
console.log(`Changed ${changed} file${changed === 1 ? '' : 's'}.`);
