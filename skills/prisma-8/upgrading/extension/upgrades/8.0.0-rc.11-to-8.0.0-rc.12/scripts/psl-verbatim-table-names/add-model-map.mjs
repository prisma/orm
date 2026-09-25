#!/usr/bin/env node
/**
 * Adds `@@map("<model name with its first letter lowered>")` to every PSL
 * `model` block that has no `@@map`, so a schema written before Prisma 8 made
 * model names verbatim keeps the table (or collection) names it already has.
 *
 * Usage:
 *   node <path to this file> <file-or-glob> [...more]
 *
 * Globs never descend into `node_modules` or `dist`.
 *
 * A model with `@@base(...)` and no `@@map` shares its base's storage, so it
 * is left alone: adding `@@map` there would split it into its own table or
 * collection.
 *
 * Files are rewritten in place; every mapped model is printed as
 * `<file>: model <Name> -> @@map("<name>")` for review. Running it twice is a
 * no-op. Only run it on a schema written against the previous release: a
 * schema inferred after upgrading already names its tables verbatim.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { glob } from 'node:fs/promises';
import { argv, exit, stderr, stdout } from 'node:process';
import { fileURLToPath } from 'node:url';

const MODEL_LINE = /^\s*model\s/;
const MODEL_START = /^(\s*)model\s+([A-Za-z_][A-Za-z0-9_]*)\s*(\{)?(.*)$/;
const OPEN_BRACE_LINE = /^\s*\{\s*(\/\/.*)?$/;
const BLANK_OR_COMMENT = /^\s*(\/\/.*)?$/;
const BLOCK_CLOSE = /^\s*\}\s*(\/\/.*)?$/;
const MAP_ATTRIBUTE = /^\s*@@map\s*\(/;
const BASE_ATTRIBUTE = /^\s*@@base\s*\(/;
const OWN_STORAGE_ATTRIBUTE = /@@(map|base)\s*\(/;

function lowerFirst(name) {
  return name.charAt(0).toLowerCase() + name.slice(1);
}

function bodyIndent(lines, start, end, headerIndent) {
  for (let i = start; i < end; i += 1) {
    const match = /^(\s*)\S/.exec(lines[i]);
    if (match) return match[1];
  }
  return `${headerIndent}  `;
}

function stripCr(line) {
  return line.replace(/\r$/, '');
}

/**
 * Classifies the `model` line at `index`. Returns the header indent, the model
 * name, the index of the first body line, any body text that shares the
 * header line, and whether the whole block sits on this one line.
 */
function nextNonBlankIndex(lines, index) {
  let i = index + 1;
  while (i < lines.length && BLANK_OR_COMMENT.test(stripCr(lines[i]))) i += 1;
  return i;
}

/**
 * A `model` line is a declaration only when the block's `{` follows the model
 * name on that line, or opens the next line that is not blank or a comment.
 * Any other `model` line is a field named `model` inside some block and is
 * left alone.
 */
function isModelDeclaration(lines, index) {
  const match = MODEL_START.exec(stripCr(lines[index]));
  if (!match) return false;
  if (match[3] !== undefined) return true;
  const next = lines[nextNonBlankIndex(lines, index)];
  return next !== undefined && OPEN_BRACE_LINE.test(stripCr(next));
}

function readModelStart(lines, index) {
  const match = MODEL_START.exec(stripCr(lines[index]));
  if (!match) return undefined;
  const [, indent, modelName, brace, rest] = match;
  if (brace === undefined) {
    if (!BLANK_OR_COMMENT.test(rest)) return undefined;
    const braceAt = nextNonBlankIndex(lines, index);
    const next = lines[braceAt];
    if (next === undefined || !OPEN_BRACE_LINE.test(stripCr(next))) return undefined;
    return { indent, modelName, bodyStart: braceAt + 1, inlineBody: '', singleLine: false };
  }
  const closeAt = closingBraceIndex(rest);
  if (closeAt !== -1) {
    return { indent, modelName, bodyStart: index + 1, inlineBody: rest, singleLine: true };
  }
  return {
    indent,
    modelName,
    bodyStart: index + 1,
    inlineBody: BLANK_OR_COMMENT.test(rest) ? '' : rest,
    singleLine: false,
  };
}

/** The line without a trailing `//` comment; a `//` inside a double-quoted string is content. */
function stripLineComment(text) {
  let quoted = false;
  for (let i = 0; i < text.length; i += 1) {
    const char = text[i];
    if (quoted) {
      if (char === '\\') i += 1;
      else if (char === '"') quoted = false;
    } else if (char === '"') {
      quoted = true;
    } else if (char === '/' && text[i + 1] === '/') {
      return text.slice(0, i).trimEnd();
    }
  }
  return text;
}

/** Index of a `}` that ends the block on this line (only whitespace or a `//` comment may follow), else -1. */
function closingBraceIndex(text) {
  const code = stripLineComment(text);
  const closeAt = code.lastIndexOf('}');
  return closeAt !== -1 && /^\s*$/.test(code.slice(closeAt + 1)) ? closeAt : -1;
}

function addMapToSingleLineModel(line, modelName) {
  const raw = stripCr(line);
  const closeAt = closingBraceIndex(raw);
  const body = raw.slice(0, closeAt);
  if (OWN_STORAGE_ATTRIBUTE.test(body)) return line;
  return `${body.trimEnd()} @@map("${lowerFirst(modelName)}") ${line.slice(closeAt)}`;
}

/** Thrown when a `model` declaration is written in a shape the codemod does not recognise. */
export class UnhandledModelError extends Error {
  constructor(lineNumbers) {
    super(`model block(s) not understood at line(s) ${lineNumbers.join(', ')}`);
    this.lineNumbers = lineNumbers;
  }
}

/**
 * Rewrites `source` and also returns the models that received an `@@map`, so a
 * caller can show the user what was mapped. The codemod cannot see storage:
 * it assumes every unmapped model was written against the release whose
 * default lowered the first letter.
 */
export function addModelMapsWithReport(source) {
  const newline = source.includes('\r\n') ? '\r' : '';
  const lines = source.split('\n');
  const out = [];
  const unhandled = [];
  const mapped = [];
  let i = 0;
  while (i < lines.length) {
    if (!MODEL_LINE.test(lines[i]) || !isModelDeclaration(lines, i)) {
      out.push(lines[i]);
      i += 1;
      continue;
    }
    const start = readModelStart(lines, i);
    if (start === undefined) {
      unhandled.push(i + 1);
      out.push(lines[i]);
      i += 1;
      continue;
    }
    if (start.singleLine) {
      const rewritten = addMapToSingleLineModel(lines[i], start.modelName);
      if (rewritten !== lines[i]) mapped.push(start.modelName);
      out.push(rewritten);
      i += 1;
      continue;
    }
    let close = start.bodyStart;
    while (close < lines.length && !BLOCK_CLOSE.test(lines[close])) close += 1;
    if (close >= lines.length) {
      unhandled.push(i + 1);
      out.push(...lines.slice(i));
      break;
    }
    const body = [start.inlineBody, ...lines.slice(start.bodyStart, close)];
    out.push(...lines.slice(i, close));
    if (!body.some((line) => MAP_ATTRIBUTE.test(line) || BASE_ATTRIBUTE.test(line))) {
      const indent = bodyIndent(lines, start.bodyStart, close, start.indent);
      out.push(`${indent}@@map("${lowerFirst(start.modelName)}")${newline}`);
      mapped.push(start.modelName);
    }
    out.push(lines[close]);
    i = close + 1;
  }
  if (unhandled.length > 0) throw new UnhandledModelError(unhandled);
  return { source: out.join('\n'), mapped };
}

export function addModelMaps(source) {
  return addModelMapsWithReport(source).source;
}

const SKIPPED_DIRECTORIES = /(^|\/)(node_modules|dist)\//;

async function expandPatterns(patterns) {
  const files = new Set();
  for (const pattern of patterns) {
    for await (const match of glob(pattern, {
      exclude: (path) => SKIPPED_DIRECTORIES.test(`${path}/`),
    })) {
      files.add(match);
    }
  }
  return [...files].sort();
}

async function main() {
  const patterns = argv.slice(2);
  if (patterns.length === 0) {
    stderr.write('usage: node add-model-map.mjs <file-or-glob> [...more]\n');
    exit(2);
  }
  const files = await expandPatterns(patterns);
  if (files.length === 0) {
    stderr.write('no files matched\n');
    exit(1);
  }
  let failed = false;
  let mappedCount = 0;
  for (const file of files) {
    const before = readFileSync(file, 'utf8');
    let result;
    try {
      result = addModelMapsWithReport(before);
    } catch (error) {
      if (!(error instanceof UnhandledModelError)) throw error;
      for (const line of error.lineNumbers)
        stderr.write(`${file}:${line}: model block not understood\n`);
      failed = true;
      continue;
    }
    if (result.source !== before) {
      writeFileSync(file, result.source);
      for (const modelName of result.mapped) {
        stdout.write(`${file}: model ${modelName} -> @@map("${lowerFirst(modelName)}")\n`);
      }
      mappedCount += result.mapped.length;
    }
  }
  if (mappedCount > 0) {
    stdout.write(
      `${mappedCount} model(s) mapped. Review the list: every one must be a model whose table or collection was created under the previous release's lowered-first-letter default. A schema written or inferred after upgrading must not be run through this codemod.\n`,
    );
  }
  if (failed) exit(1);
}

if (argv[1] && fileURLToPath(import.meta.url) === argv[1]) {
  await main();
}
