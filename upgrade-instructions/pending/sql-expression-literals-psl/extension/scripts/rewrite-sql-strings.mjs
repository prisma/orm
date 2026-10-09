#!/usr/bin/env node
/**
 * Rewrites raw SQL written as a quoted string in PSL into a `sql` literal with the same text:
 * the `where:` and `expression:` arguments of `@@index`, `@@fullTextIndex` and `@@check`, and
 * `using =` and `withCheck =` in `policy_*` blocks.
 *
 * Usage:
 *   node scripts/codemods/rewrite-sql-strings.mjs <file-or-glob> [...more]
 *
 * Globs never descend into `node_modules` or `dist`. Files are rewritten in place, and each
 * changed file is printed with its number of rewrites. Running it twice is a no-op.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const ATTRIBUTE_START = /@@(index|fullTextIndex|check)\s*\(/g;
const ATTRIBUTE_ARGUMENT = /^(where|expression)\s*:\s*$/;
const POLICY_START = /^[ \t]*policy_[A-Za-z]+\s+[A-Za-z_][A-Za-z0-9_]*\s*\{/gm;
const POLICY_ENTRY = /(^|\n)([ \t]*(using|withCheck)\s*=\s*)$/;
const TAG = 'sql';

/** The end (exclusive) of the quoted string that starts at `start`, or -1 when it is not closed. */
function stringEnd(source, start) {
  const quote = source[start];
  for (let i = start + 1; i < source.length; i += 1) {
    if (source[i] === '\\') {
      i += 1;
      continue;
    }
    if (source[i] === quote) return i + 1;
    if (source[i] === '\n') return -1;
  }
  return -1;
}

/** The index of the line break that ends the `//` comment starting at `start`, or the source length. */
function commentEnd(source, start) {
  const newline = source.indexOf('\n', start);
  return newline === -1 ? source.length : newline;
}

/** The `[start, end)` ranges of `//` and `///` comments, quoted strings and backtick literals: text in which nothing declares an attribute or a policy. */
function inertRanges(source) {
  const ranges = [];
  for (let i = 0; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'") {
      const end = stringEnd(source, i);
      if (end !== -1) ranges.push([i, end]);
      i = end === -1 ? commentEnd(source, i) : end - 1;
      continue;
    }
    if (ch === '`') {
      const end = source.indexOf('`', i + 1);
      if (end === -1) continue;
      ranges.push([i, end + 1]);
      i = end;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const end = commentEnd(source, i);
      ranges.push([i, end]);
      i = end;
    }
  }
  return ranges;
}

/** The end (exclusive) of the bracketed region opening at `open`, skipping strings and tagged literals. */
function closingEnd(source, open, openChar, closeChar) {
  let depth = 0;
  for (let i = open; i < source.length; i += 1) {
    const ch = source[i];
    if (ch === '"' || ch === "'" || ch === '`') {
      const end = ch === '`' ? source.indexOf('`', i + 1) + 1 : stringEnd(source, i);
      if (end <= 0) return -1;
      i = end - 1;
      continue;
    }
    if (ch === '/' && source[i + 1] === '/') {
      const newline = source.indexOf('\n', i);
      if (newline === -1) return -1;
      i = newline;
      continue;
    }
    if (ch === openChar) depth += 1;
    if (ch === closeChar) {
      depth -= 1;
      if (depth === 0) return i + 1;
    }
  }
  return -1;
}

function hexAt(raw, start, length) {
  const digits = raw.slice(start, start + length);
  return digits.length === length && /^[0-9A-Fa-f]+$/.test(digits)
    ? String.fromCharCode(Number.parseInt(digits, 16))
    : undefined;
}

const SIMPLE_ESCAPES = {
  '/': '/',
  b: '\b',
  f: '\f',
  n: '\n',
  r: '\r',
  t: '\t',
  '"': '"',
  "'": "'",
  '\\': '\\',
};

/** The text of a PSL string literal body, decoded as the PSL parser decodes it. */
export function decodePslString(raw) {
  let out = '';
  for (let i = 0; i < raw.length; i += 1) {
    const ch = raw[i];
    if (ch !== '\\' || i + 1 >= raw.length) {
      out += ch;
      continue;
    }
    const next = raw[i + 1];
    if (Object.hasOwn(SIMPLE_ESCAPES, next)) {
      out += SIMPLE_ESCAPES[next];
      i += 1;
      continue;
    }
    const length = next === 'x' ? 2 : next === 'u' ? 4 : 0;
    const decoded = length === 0 ? undefined : hexAt(raw, i + 2, length);
    if (decoded === undefined) {
      out += `\\${next}`;
      i += 1;
      continue;
    }
    out += decoded;
    i += 1 + length;
  }
  return out;
}

/** A `sql` literal holding `text`: the backtick form, or the double-quote form when the text holds a backtick. */
export function printSqlLiteral(text) {
  if (text.includes('`')) {
    const escaped = text
      .replace(/\\/g, '\\\\')
      .replace(/"/g, '\\"')
      .replace(/\n/g, '\\n')
      .replace(/\r/g, '\\r');
    return `${TAG}"${escaped}"`;
  }
  const fenced = text.replace(/\\/g, '\\\\');
  return text.includes('\n') ? `${TAG}\`\n${fenced}\n\`` : `${TAG}\`${fenced}\``;
}

/** The quoted strings to rewrite, as `[start, end)` ranges of `source`. */
function stringRanges(source) {
  const inert = inertRanges(source);
  const isInert = (index) => inert.some(([start, end]) => index >= start && index < end);
  const ranges = [];
  for (const match of source.matchAll(ATTRIBUTE_START)) {
    if (isInert(match.index)) continue;
    const open = match.index + match[0].length - 1;
    const close = closingEnd(source, open, '(', ')');
    if (close === -1) continue;
    let depth = 0;
    let argumentStart = open + 1;
    for (let i = open + 1; i < close - 1; i += 1) {
      const ch = source[i];
      if (ch === '/' && source[i + 1] === '/') {
        i = commentEnd(source, i);
        continue;
      }
      if (ch === '"' || ch === "'") {
        const end = stringEnd(source, i);
        if (end === -1) break;
        const before = source.slice(argumentStart, i).trim();
        if (depth === 0 && ATTRIBUTE_ARGUMENT.test(before)) ranges.push([i, end]);
        i = end - 1;
        continue;
      }
      if (ch === '`') {
        i = source.indexOf('`', i + 1);
        if (i === -1) break;
        continue;
      }
      if (ch === '(' || ch === '[' || ch === '{') depth += 1;
      if (ch === ')' || ch === ']' || ch === '}') depth -= 1;
      if (ch === ',' && depth === 0) argumentStart = i + 1;
    }
  }
  for (const match of source.matchAll(POLICY_START)) {
    if (isInert(match.index + match[0].search(/\S/))) continue;
    const open = match.index + match[0].length - 1;
    const close = closingEnd(source, open, '{', '}');
    if (close === -1) continue;
    for (let i = open + 1; i < close - 1; i += 1) {
      const ch = source[i];
      if (ch === '/' && source[i + 1] === '/') {
        i = commentEnd(source, i);
        continue;
      }
      if (ch === '"' || ch === "'") {
        const end = stringEnd(source, i);
        if (end === -1) break;
        if (POLICY_ENTRY.test(source.slice(open + 1, i))) ranges.push([i, end]);
        i = end - 1;
        continue;
      }
      if (ch === '`') {
        i = source.indexOf('`', i + 1);
        if (i === -1) break;
      }
    }
  }
  return ranges.sort((a, b) => a[0] - b[0]);
}

/** Rewrites `source` and returns it with the number of strings rewritten. */
export function rewriteSqlStringsWithCount(source) {
  const ranges = stringRanges(source);
  let out = '';
  let position = 0;
  for (const [start, end] of ranges) {
    out += source.slice(position, start);
    out += printSqlLiteral(decodePslString(source.slice(start + 1, end - 1)));
    position = end;
  }
  out += source.slice(position);
  return { source: out, count: ranges.length };
}

export function rewriteSqlStrings(source) {
  return rewriteSqlStringsWithCount(source).source;
}

const SKIPPED_DIRECTORIES = /(^|\/)(node_modules|dist)\//;

async function filesMatching(patterns) {
  const files = new Set();
  for (const pattern of patterns) {
    for await (const match of glob(pattern, {
      exclude: (path) => /(^|\/)(node_modules|dist)$/.test(path),
    })) {
      if (!SKIPPED_DIRECTORIES.test(match)) files.add(match);
    }
  }
  return [...files].sort();
}

async function main() {
  const patterns = argv.slice(2);
  if (patterns.length === 0) {
    stderr.write('usage: node rewrite-sql-strings.mjs <file-or-glob> [...more]\n');
    exit(2);
  }
  for (const file of await filesMatching(patterns)) {
    const before = readFileSync(file, 'utf8');
    const { source, count } = rewriteSqlStringsWithCount(before);
    if (count === 0) continue;
    writeFileSync(file, source);
    stdout.write(`${file}: ${count} rewritten\n`);
  }
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  await main();
}
