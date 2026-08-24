/**
 * Removes bare migration op factory imports and rewrites call-sites to use
 * the method form on `this` (0.13 → 0.14):
 *
 *   dropColumn(schema, table, col)  →  this.dropColumn({ schema, table, column: col })
 *   setNotNull(schema, table, col)  →  this.setNotNull({ schema, table, column: col })
 *   setDefault(schema, table, col, sql)
 *     → this.setDefault({ schema, table, column: col, defaultSql: sql })
 *   addPrimaryKey(schema, table, name, cols)
 *     → this.addPrimaryKey({ schema, table, constraint: name, columns: cols })
 *   addForeignKey(schema, table, { name, columns, references, onDelete })
 *     → this.addForeignKey({ schema, table, foreignKey: { name, columns, references, onDelete } })
 *   addCheckConstraint(schema, table, name, col, vals)
 *     → this.addCheckConstraint({ schema, table, constraint: name, column: col, values: vals })
 *   createIndex(schema, table, idx, cols)
 *     → this.createIndex({ schema, table, index: idx, columns: cols })
 *   installExtension({ ... })  →  this.installExtension({ ... })
 *
 * Applies to files importing from '@internal/postgres/migration',
 * '@internal/target-postgres/migration', '@internal/sqlite/migration', or
 * '@internal/target-sqlite/migration'. Handles only call-sites where all
 * arguments are simple literals or identifiers on a single logical token (no
 * multi-line positional calls). For complex cases the type-checker will flag
 * remaining sites.
 *
 * Run from the project root:
 *   pnpm exec tsx <path-to-this-file>
 */

import { execSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'pathe';

const FACTORY_NAMES = [
  'dropColumn',
  'setNotNull',
  'setDefault',
  'addPrimaryKey',
  'addForeignKey',
  'addCheckConstraint',
  'createIndex',
  'installExtension',
];

/**
 * Strip bare factory names from import declarations (handles both single-line
 * and multi-line `import { ... } from '...'` forms). Removes the whole import
 * line (including trailing newline) when all names are factories.
 */
function stripFactoriesFromImports(src: string): string {
  const importRe =
    /^[^\S\n]*import\s*\{([^}]+)\}\s*from\s*'@internal\/(?:postgres|target-postgres|sqlite|target-sqlite)\/migration'[^\S\n]*;?[^\S\n]*\n?/gms;
  return src.replace(importRe, (full, nameBlock) => {
    const names = nameBlock
      .split(',')
      .map((n: string) => n.trim())
      .filter((n: string) => n.length > 0 && !FACTORY_NAMES.includes(n));
    if (names.length === 0) return '';
    const fromClause = full.slice(full.indexOf('}') + 1);
    return `import { ${names.join(', ')} }${fromClause}`;
  });
}

/** Reads a quoted string or bare identifier/bracket-balanced token starting at offset. */
function readToken(src: string, offset: number): { value: string; end: number } | null {
  let i = offset;
  while (i < src.length && src[i] === ' ') i++;
  if (i >= src.length) return null;
  if (src[i] === "'" || src[i] === '"' || src[i] === '`') {
    const q = src[i];
    let end = i + 1;
    while (end < src.length && src[end] !== q) end++;
    return { value: src.slice(i, end + 1), end: end + 1 };
  }
  let depth = 0;
  let end = i;
  while (end < src.length) {
    const c = src[end];
    if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') {
      if (depth === 0) break;
      depth--;
    } else if ((c === ',' || c === '\n') && depth === 0) break;
    end++;
  }
  return { value: src.slice(i, end).trim(), end };
}

type Rewrite = {
  pattern: RegExp;
  rewrite: (m: RegExpExecArray) => string | null;
};

const rewrites: Rewrite[] = [
  // dropColumn(schema, table, column)
  {
    pattern: /\bdropColumn\(/g,
    rewrite(m) {
      const rest = m.input.slice(m.index + m[0].length);
      const s = readToken(rest, 0);
      if (!s) return null;
      const t = readToken(rest, s.end + 1);
      if (!t) return null;
      const c = readToken(rest, t.end + 1);
      if (!c) return null;
      return `this.dropColumn({ schema: ${s.value}, table: ${t.value}, column: ${c.value} })`;
    },
  },
  // setNotNull(schema, table, column)
  {
    pattern: /\bsetNotNull\(/g,
    rewrite(m) {
      const rest = m.input.slice(m.index + m[0].length);
      const s = readToken(rest, 0);
      if (!s) return null;
      const t = readToken(rest, s.end + 1);
      if (!t) return null;
      const c = readToken(rest, t.end + 1);
      if (!c) return null;
      return `this.setNotNull({ schema: ${s.value}, table: ${t.value}, column: ${c.value} })`;
    },
  },
  // setDefault(schema, table, column, defaultSql)
  {
    pattern: /\bsetDefault\(/g,
    rewrite(m) {
      const rest = m.input.slice(m.index + m[0].length);
      const s = readToken(rest, 0);
      if (!s) return null;
      const t = readToken(rest, s.end + 1);
      if (!t) return null;
      const c = readToken(rest, t.end + 1);
      if (!c) return null;
      const d = readToken(rest, c.end + 1);
      if (!d) return null;
      return `this.setDefault({ schema: ${s.value}, table: ${t.value}, column: ${c.value}, defaultSql: ${d.value} })`;
    },
  },
  // addPrimaryKey(schema, table, constraintName, columns)
  {
    pattern: /\baddPrimaryKey\(/g,
    rewrite(m) {
      const rest = m.input.slice(m.index + m[0].length);
      const s = readToken(rest, 0);
      if (!s) return null;
      const t = readToken(rest, s.end + 1);
      if (!t) return null;
      const n = readToken(rest, t.end + 1);
      if (!n) return null;
      const c = readToken(rest, n.end + 1);
      if (!c) return null;
      return `this.addPrimaryKey({ schema: ${s.value}, table: ${t.value}, constraint: ${n.value}, columns: ${c.value} })`;
    },
  },
  // addCheckConstraint(schema, table, constraintName, column, values)
  {
    pattern: /\baddCheckConstraint\(/g,
    rewrite(m) {
      const rest = m.input.slice(m.index + m[0].length);
      const s = readToken(rest, 0);
      if (!s) return null;
      const t = readToken(rest, s.end + 1);
      if (!t) return null;
      const n = readToken(rest, t.end + 1);
      if (!n) return null;
      const c = readToken(rest, n.end + 1);
      if (!c) return null;
      const v = readToken(rest, c.end + 1);
      if (!v) return null;
      return `this.addCheckConstraint({ schema: ${s.value}, table: ${t.value}, constraint: ${n.value}, column: ${c.value}, values: ${v.value} })`;
    },
  },
  // createIndex(schema, table, indexName, columns)
  {
    pattern: /\bcreateIndex\(/g,
    rewrite(m) {
      const rest = m.input.slice(m.index + m[0].length);
      const s = readToken(rest, 0);
      if (!s) return null;
      const t = readToken(rest, s.end + 1);
      if (!t) return null;
      const idx = readToken(rest, t.end + 1);
      if (!idx) return null;
      const c = readToken(rest, idx.end + 1);
      if (!c) return null;
      return `this.createIndex({ schema: ${s.value}, table: ${t.value}, index: ${idx.value}, columns: ${c.value} })`;
    },
  },
  // addForeignKey(schema, table, { ... }) — wraps opts in `foreignKey:`
  {
    pattern: /\baddForeignKey\(/g,
    rewrite(m) {
      const rest = m.input.slice(m.index + m[0].length);
      const s = readToken(rest, 0);
      if (!s) return null;
      const t = readToken(rest, s.end + 1);
      if (!t) return null;
      const opts = readToken(rest, t.end + 1);
      if (!opts) return null;
      return `this.addForeignKey({ schema: ${s.value}, table: ${t.value}, foreignKey: ${opts.value} })`;
    },
  },
];

function applyRewrites(src: string): string {
  // installExtension already takes an object — just prepend `this.`
  let out = src.replace(/(?<!this\.)(?<!\.)\binstallExtension\(/g, 'this.installExtension(');

  for (const { pattern, rewrite } of rewrites) {
    pattern.lastIndex = 0;
    let result = '';
    let last = 0;
    let match = pattern.exec(out);
    while (match !== null) {
      const before = out.slice(Math.max(0, match.index - 5), match.index);
      if (before.endsWith('this.')) {
        result += out.slice(last, match.index + match[0].length);
        last = match.index + match[0].length;
        match = pattern.exec(out);
        continue;
      }
      const replacement = rewrite(match);
      if (replacement === null) {
        result += out.slice(last, match.index + match[0].length);
        last = match.index + match[0].length;
        match = pattern.exec(out);
        continue;
      }
      // Find the matching closing paren for the original call
      let depth = 1;
      let end = match.index + match[0].length;
      while (end < out.length && depth > 0) {
        if (out[end] === '(') depth++;
        else if (out[end] === ')') depth--;
        end++;
      }
      result += out.slice(last, match.index) + replacement;
      last = end;
      pattern.lastIndex = last;
      match = pattern.exec(out);
    }
    out = result + out.slice(last);
  }
  return out;
}

function processFile(src: string): string {
  const MIGRATION_IMPORT_RE =
    /import\s*\{[^}]+\}\s*from\s*'@internal\/(?:postgres|target-postgres|sqlite|target-sqlite)\/migration'/s;

  if (!MIGRATION_IMPORT_RE.test(src)) return src;

  const withImports = stripFactoriesFromImports(src);
  return applyRewrites(withImports);
}

const raw = execSync(
  'git ls-files --cached --others --exclude-standard -- "**migration.ts" "migration.ts"',
  { encoding: 'utf-8' },
).trim();

const files = raw
  .split('\n')
  .filter(Boolean)
  .filter((f) => f.endsWith('migration.ts'));

let changed = 0;
for (const file of files) {
  const abs = join(process.cwd(), file);
  let content: string;
  try {
    content = readFileSync(abs, 'utf-8');
  } catch {
    continue;
  }
  const relevant =
    content.includes("from '@internal/postgres/migration'") ||
    content.includes("from '@internal/target-postgres/migration'") ||
    content.includes("from '@internal/sqlite/migration'") ||
    content.includes("from '@internal/target-sqlite/migration'");
  if (!relevant) continue;

  const updated = processFile(content);
  if (updated !== content) {
    writeFileSync(abs, updated, 'utf-8');
    console.log(`updated ${file}`);
    changed++;
  }
}
console.log(`done — ${changed} file(s) updated`);
