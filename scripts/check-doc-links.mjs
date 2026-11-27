#!/usr/bin/env node
/**
 * Fails when a Markdown file links to a file git does not know about, or to a heading that the
 * target Markdown file does not have.
 *
 * Usage: node scripts/check-doc-links.mjs
 *
 * Files scanned and valid targets: `git ls-files --cached --others --exclude-standard`, so new
 * files count before they are staged and gitignored files never count.
 *
 * Files not scanned (links pointing into them are still checked):
 * - projects/<project>/**: transient project files, deleted when the project closes.
 * - src/init/ folders under packages/: templates `init` writes into a new project; links resolve
 *   there.
 * - skills-contrib/<skill>/assets/**: templates a skill copies into another repository.
 *
 * Link forms read: inline links and images, including link text that wraps lines or holds
 * brackets and titles in quotes or parentheses; reference definitions; html `href` and `src`.
 * Links to https://github.com/prisma/orm/(blob|tree)/main/ are checked as repository paths. Other
 * absolute URLs, links pinned to a tag or commit, `...` and `{{placeholder}}` are skipped.
 *
 * Known differences from GitHub's renderer: a code span that wraps lines is not recognised, a
 * list item's own indented code block is read as text, links inside a `<pre>` block are read, an
 * unquoted `href=x` is not read, an `href=` inside another attribute's value is read, and `id`
 * attributes on elements other than `<a>` are not anchors.
 */

import { execFileSync } from 'node:child_process';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, join, normalize } from 'node:path';
import { fileURLToPath } from 'node:url';

export const EXCLUDED_PATTERNS = [
  /^projects\/[^/]+\//,
  /^packages\/.*\/src\/init\//,
  /^skills-contrib\/[^/]+\/assets\//,
];

const MARKDOWN_EXTENSION = /\.mdc?$/;
const FENCE = /^\s*(`{3,}|~{3,})/;
const LIST_ITEM = /^\s*([-*+]|\d+[.)])\s/;
const INDENTED = /^( {4}|\t)/;
const BLOCKQUOTE = /^ {0,3}(>\s?)+/;
const BLOCK_START = /^(?: {0,3}>\s?)* {0,3}$/;
const DEFINITION = /^ {0,3}\[(?!\^)(?:[^\]\\]|\\.)+\]:\s*(?:<([^>\n]*)>|(\S+))/;
const HTML_LINK = /<(?:a|img|source)\b[^>]*?\s(?:href|src)\s*=\s*["']([^"']*)["']/gi;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const GITHUB_MAIN =
  /^https:\/\/github\.com\/prisma\/orm\/(?:blob|tree)\/main(?=$|[/?#])(\/[^?#]*)?(.*)$/;
const ATX_HEADING = /^ {0,3}#{1,6}(\s|$)/;
const EXPLICIT_ANCHOR = /<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;
const LINE_ANCHOR = /^L\d+(C\d+)?(-L\d+(C\d+)?)?$/;
const ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };

export function isExcluded(path) {
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(path));
}

function blankCodeSpans(line) {
  return line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, (span) => ' '.repeat(span.length));
}

function blankComments(line, startsInComment) {
  const code = blankCodeSpans(line);
  const blank = (from, to) => ' '.repeat(to - from);
  let text = '';
  let at = 0;
  if (startsInComment) {
    const close = line.indexOf('-->');
    if (close === -1) return { text: blank(0, line.length), inComment: true };
    text = blank(0, close + 3);
    at = close + 3;
  }
  while (at < line.length) {
    const open = code.indexOf('<!--', at);
    if (open === -1) break;
    const close = line.indexOf('-->', open + 4);
    if (close === -1) {
      if (!BLOCK_START.test(line.slice(0, open))) break;
      return { text: text + line.slice(at, open) + blank(open, line.length), inComment: true };
    }
    text += line.slice(at, open) + blank(open, close + 3);
    at = close + 3;
  }
  return { text: text + line.slice(at), inComment: false };
}

function* proseLines(content) {
  const lines = content.split(/\r?\n/);
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) start = end + 1;
  }
  let fence = null;
  let fenceQuoted = false;
  let inList = false;
  let inIndentedCode = false;
  let previousBlank = true;
  let inComment = false;
  let commentQuoted = false;
  for (let i = start; i < lines.length; i++) {
    const raw = lines[i];
    const unquoted = raw.replace(BLOCKQUOTE, '');
    if (fence !== null && fenceQuoted && !BLOCKQUOTE.test(raw)) fence = null;
    if (fence !== null) {
      const closing = FENCE.exec(unquoted);
      if (
        closing &&
        closing[1][0] === fence[0] &&
        closing[1].length >= fence.length &&
        unquoted.trim() === closing[1]
      ) {
        fence = null;
      }
      continue;
    }
    if (inComment && commentQuoted && !BLOCKQUOTE.test(raw)) inComment = false;
    const uncommented = blankComments(raw, inComment);
    if (uncommented.inComment && !inComment) commentQuoted = BLOCKQUOTE.test(raw);
    inComment = uncommented.inComment;
    const line = uncommented.text;
    if (line.replace(BLOCKQUOTE, '').trim() === '') {
      previousBlank = true;
      yield { text: '', line: i + 1 };
      continue;
    }
    const fenceLine = line.replace(BLOCKQUOTE, '');
    const opening = FENCE.exec(fenceLine);
    if (opening && !(opening[1][0] === '`' && fenceLine.slice(opening[0].length).includes('`'))) {
      fence = opening[1];
      fenceQuoted = fenceLine !== line;
      previousBlank = false;
      yield { text: '', line: i + 1 };
      continue;
    }
    if (LIST_ITEM.test(line)) inList = true;
    else if (previousBlank && !INDENTED.test(line)) inList = false;
    const indentedCode = !inList && INDENTED.test(line) && (previousBlank || inIndentedCode);
    inIndentedCode = indentedCode;
    previousBlank = false;
    yield { text: indentedCode ? '' : line, line: i + 1 };
  }
}

function closingBracket(text, start) {
  let depth = 0;
  for (let i = start; i < text.length; i++) {
    const c = text[i];
    if (c === '\\') i++;
    else if (c === '[') depth++;
    else if (c === ']' && --depth === 0) return i;
  }
  return -1;
}

function skipSpace(text, i) {
  let at = i;
  while (at < text.length && /\s/.test(text[at])) at++;
  return at;
}

function readInlineTarget(text, open) {
  const close = closingBracket(text, open);
  if (close === -1 || text[close + 1] !== '(') return null;
  let i = skipSpace(text, close + 2);
  let target;
  if (text[i] === '<') {
    const end = text.indexOf('>', i);
    if (end === -1 || text.slice(i, end).includes('\n')) return null;
    target = text.slice(i + 1, end);
    i = end + 1;
  } else {
    const begin = i;
    let depth = 0;
    for (; i < text.length; i++) {
      const c = text[i];
      if (c === '\\') i++;
      else if (/\s/.test(c)) break;
      else if (c === '(') depth++;
      else if (c === ')' && depth-- === 0) break;
    }
    target = text.slice(begin, i);
  }
  i = skipSpace(text, i);
  const opener = text[i];
  if (opener === '"' || opener === "'" || opener === '(') {
    const end = text.indexOf(opener === '(' ? ')' : opener, i + 1);
    if (end === -1) return null;
    i = skipSpace(text, end + 1);
  }
  return text[i] === ')' ? target.replace(/\\(.)/g, '$1') : null;
}

function scanParagraph(paragraph, links) {
  const text = paragraph
    .map((entry) => entry.text)
    .join('\n')
    .replace(/<!--[\s\S]*?-->/g, (comment) => comment.replace(/[^\n]/g, ' '));
  const starts = [];
  let offset = 0;
  for (const entry of paragraph) {
    starts.push(offset);
    offset += entry.text.length + 1;
  }
  const lineAt = (index) => {
    let i = starts.length - 1;
    while (starts[i] > index) i--;
    return paragraph[i].line;
  };
  const found = [];
  for (let i = 0; i < text.length; i++) {
    if (text[i] === '\\') i++;
    else if (text[i] === '[') {
      const target = readInlineTarget(text, i);
      if (target !== null) found.push({ index: i, target });
    }
  }
  for (const match of text.matchAll(HTML_LINK))
    found.push({ index: match.index, target: match[1] });
  found.sort((a, b) => a.index - b.index);
  for (const { index, target } of found) links.push({ target, line: lineAt(index) });
}

export function extractLinks(content) {
  const links = [];
  let paragraph = [];
  const flush = () => {
    if (paragraph.length > 0) scanParagraph(paragraph, links);
    paragraph = [];
  };
  for (const entry of proseLines(content)) {
    const definition =
      paragraph.length === 0 && DEFINITION.exec(entry.text.replace(BLOCKQUOTE, ''));
    if (definition) {
      links.push({
        target: (definition[1] ?? definition[2]).replace(/\\(.)/g, '$1'),
        line: entry.line,
      });
      continue;
    }
    if (entry.text === '' || LIST_ITEM.test(entry.text) || ATX_HEADING.test(entry.text)) flush();
    if (entry.text !== '') paragraph.push({ text: blankCodeSpans(entry.text), line: entry.line });
    if (ATX_HEADING.test(entry.text)) flush();
  }
  flush();
  return links;
}

function decodeEntities(text) {
  return text.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (entity, name) => {
    if (name[0] === '#') {
      const code =
        name[1].toLowerCase() === 'x' ? Number.parseInt(name.slice(2), 16) : Number(name.slice(1));
      return String.fromCodePoint(code);
    }
    return ENTITIES[name.toLowerCase()] ?? entity;
  });
}

function headingText(raw) {
  const spans = [];
  const protectedText = raw
    .trim()
    .replace(/\s+#+\s*$/, '')
    .replace(/^#+$/, '')
    .replace(/(`+)\s?((?:(?!\1)[\s\S])*?)\s?\1/g, (_, __, code) => {
      spans.push(code);
      return `\uE000${spans.length - 1}\uE000`;
    });
  return decodeEntities(
    protectedText
      .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, '')
      .replace(/[*~]/g, '')
      .replace(/(^|[^\p{L}\p{N}])_+([^_]+?)_+(?=[^\p{L}\p{N}]|$)/gu, '$1$2'),
  )
    .trim()
    .replace(/\uE000(\d+)\uE000/g, (_, index) => spans[Number(index)]);
}

export function slugify(text) {
  return headingText(text)
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

export function collectAnchors(content) {
  const anchors = new Set();
  const counts = new Map();
  const addHeading = (text) => {
    const base = slugify(text);
    let slug = base;
    while (anchors.has(slug)) {
      const next = (counts.get(base) ?? 0) + 1;
      counts.set(base, next);
      slug = `${base}-${next}`;
    }
    anchors.add(slug);
  };
  let previous = null;
  for (const entry of proseLines(content)) {
    const text = entry.text.replace(BLOCKQUOTE, '');
    for (const match of text.matchAll(EXPLICIT_ANCHOR)) anchors.add(match[1]);
    const atx = /^ {0,3}#{1,6}(?:\s+(.*))?$/.exec(text);
    if (atx) {
      addHeading(atx[1] ?? '');
      previous = null;
      continue;
    }
    if (previous !== null && /^ {0,3}(=+|-+)\s*$/.test(text)) {
      addHeading(previous);
      previous = null;
      continue;
    }
    previous = text.trim() === '' || LIST_ITEM.test(text) ? null : text;
  }
  return anchors;
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function splitTarget(target) {
  const match = /^([^?#]*)(?:\?([^#]*))?(?:#(.*))?$/.exec(target);
  return {
    path: decode(match[1]),
    query: match[2] ?? null,
    anchor: match[3] === undefined ? null : decode(match[3]),
  };
}

export function resolveTarget(fromFile, path) {
  if (path === '') return fromFile;
  const resolved = normalize(
    path.startsWith('/') ? path.slice(1) || '.' : join(dirname(fromFile), path),
  ).replace(/\/$/, '');
  return resolved === '.' ? '' : resolved;
}

function localTarget(target) {
  const github = GITHUB_MAIN.exec(target);
  if (github) return `${github[1] || '/'}${github[2]}`;
  if (
    target === '' ||
    target === '...' ||
    target.includes('{{') ||
    SCHEME.test(target) ||
    target.startsWith('//')
  ) {
    return null;
  }
  return target;
}

/**
 * Checks every link in `content`, read from repository-relative `file`. `io.exists(path)` says
 * whether git knows the path (`''` is the root), `io.isFile(path)` whether it is a file, and
 * `io.readFile(path)` returns its text.
 */
export function checkFile(file, content, io) {
  const problems = [];
  for (const { target, line } of extractLinks(content)) {
    const local = localTarget(target);
    if (local === null) continue;
    const { path, query, anchor } = splitTarget(local);
    const resolved = resolveTarget(file, path);
    if (resolved.startsWith('..')) {
      problems.push({ file, line, target, reason: 'points outside the repository' });
      continue;
    }
    if (!io.exists(resolved)) {
      problems.push({ file, line, target, reason: 'file not found' });
      continue;
    }
    if (!anchor || !MARKDOWN_EXTENSION.test(resolved) || !io.isFile(resolved)) continue;
    if (query !== null && /(^|&)plain=1(&|$)/.test(query) && LINE_ANCHOR.test(anchor)) continue;
    const anchors = collectAnchors(io.readFile(resolved));
    if (!anchors.has(anchor) && !anchors.has(anchor.toLowerCase())) {
      problems.push({ file, line, target, reason: `no heading #${anchor}` });
    }
  }
  return problems;
}

export function formatProblem({ file, line, target, reason }) {
  return `${file}:${line}: ${target} (${reason})`;
}

function listRepositoryFiles(root) {
  return execFileSync('git', ['ls-files', '-z', '--cached', '--others', '--exclude-standard'], {
    cwd: root,
    encoding: 'utf8',
    maxBuffer: 256 * 1024 * 1024,
  })
    .split('\0')
    .filter((file) => {
      if (file === '') return false;
      try {
        lstatSync(join(root, file));
        return true;
      } catch {
        return false;
      }
    });
}

function createRepositoryIo(root, files) {
  const fileSet = new Set(files);
  const known = new Set(['', ...files]);
  for (const file of files) {
    for (let dir = dirname(file); dir !== '.' && !known.has(dir); dir = dirname(dir))
      known.add(dir);
  }
  const cache = new Map();
  return {
    exists: (path) => known.has(path),
    isFile: (path) => fileSet.has(path),
    readFile: (path) => {
      if (!cache.has(path)) cache.set(path, readFileSync(join(root, path), 'utf8'));
      return cache.get(path);
    },
  };
}

function distinctFiles(root, files) {
  const byRealPath = new Map();
  for (const file of files) {
    const real = realpathSync(join(root, file));
    const current = byRealPath.get(real);
    if (current === undefined || lstatSync(join(root, current)).isSymbolicLink())
      byRealPath.set(real, file);
  }
  return [...byRealPath.values()];
}

export function checkRepository(root) {
  const files = listRepositoryFiles(root);
  const io = createRepositoryIo(root, files);
  const scanned = distinctFiles(
    root,
    files.filter((file) => MARKDOWN_EXTENSION.test(file) && !isExcluded(file)),
  ).sort();
  return scanned.flatMap((file) => checkFile(file, io.readFile(file), io));
}

function main() {
  const problems = checkRepository(join(dirname(fileURLToPath(import.meta.url)), '..'));
  for (const problem of problems) console.error(formatProblem(problem));
  if (problems.length > 0) {
    console.error(`\n${problems.length} broken link(s)`);
    process.exit(1);
  }
}

if (process.argv[1] && realpathSync(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main();
}
