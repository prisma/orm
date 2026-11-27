#!/usr/bin/env node
/**
 * Fails when a tracked Markdown file has a relative link to a file that does not exist, or to a
 * heading that the target Markdown file does not have.
 *
 * Usage: node scripts/check-doc-links.mjs
 *
 * Files not scanned (links pointing into them are still checked):
 * - docs/releases/**, CHANGELOG.md: published release notes, a historical record.
 * - skills/prisma-8/upgrading/<audience>/upgrades/**: shipped upgrade guides, a historical record.
 * - upgrade-instructions/releases/**: archived originals of shipped upgrade guides, kept unchanged.
 * - projects/<project>/**: transient project files, deleted when the project closes.
 * - src/init/ folders under packages/: templates `init` writes into a new project; links resolve there.
 * - skills-contrib/<skill>/assets/**: templates a skill copies into another repository.
 *
 * Targets that are not file paths are skipped: absolute URLs, `...` and `{{placeholder}}`.
 */

import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import { dirname, join, normalize, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO_ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');

export const EXCLUDED_PATTERNS = [
  /^docs\/releases\//,
  /^CHANGELOG\.md$/,
  /^skills\/prisma-8\/upgrading\/[^/]+\/upgrades\//,
  /^upgrade-instructions\/releases\//,
  /^projects\/[^/]+\//,
  /^packages\/.*\/src\/init\//,
  /^skills-contrib\/[^/]+\/assets\//,
];

const MARKDOWN_EXTENSION = /\.mdc?$/;
const FENCE = /^ {0,3}(`{3,}|~{3,})/;
const INLINE_LINK =
  /\[(?:[^\]\\]|\\.)*\]\(\s*(?:<([^>\n]*)>|([^)\s]+))(?:\s+(?:"[^"]*"|'[^']*'))?\s*\)/g;
const SCHEME = /^[a-z][a-z0-9+.-]*:/i;
const EXPLICIT_ANCHOR = /<a\s[^>]*?\b(?:id|name)\s*=\s*["']([^"']+)["']/gi;

export function isExcluded(path) {
  return EXCLUDED_PATTERNS.some((pattern) => pattern.test(path));
}

function blankCodeSpans(line) {
  return line.replace(/(`+)(?:(?!\1)[\s\S])*?\1/g, (span) => ' '.repeat(span.length));
}

function* proseLines(content) {
  const lines = content.split(/\r?\n/);
  let fence = null;
  let start = 0;
  if (lines[0] === '---') {
    const end = lines.indexOf('---', 1);
    if (end > 0) start = end + 1;
  }
  for (let i = start; i < lines.length; i++) {
    const line = lines[i];
    const opening = FENCE.exec(line);
    if (fence === null) {
      if (opening) {
        fence = opening[1];
        continue;
      }
      yield { text: line, line: i + 1 };
    } else if (
      opening &&
      opening[1][0] === fence[0] &&
      opening[1].length >= fence.length &&
      line.trim() === opening[1]
    ) {
      fence = null;
    }
  }
}

export function extractLinks(content) {
  const links = [];
  for (const { text, line } of proseLines(content)) {
    const prose = blankCodeSpans(text);
    for (const match of prose.matchAll(INLINE_LINK)) {
      links.push({ target: match[1] ?? match[2], line });
    }
  }
  return links;
}

function headingText(raw) {
  return raw
    .replace(/\s+#+\s*$/, '')
    .replace(/`([^`]*)`/g, '$1')
    .replace(/!?\[([^\]]*)\]\([^)]*\)/g, '$1')
    .replace(/<[^>]+>/g, '')
    .replace(/[*~]/g, '')
    .replace(/(^|[^\p{L}\p{N}])_+([^_]+?)_+(?=[^\p{L}\p{N}]|$)/gu, '$1$2');
}

export function slugify(text) {
  return headingText(text)
    .trim()
    .toLowerCase()
    .replace(/[^\p{L}\p{M}\p{N}\p{Pc} -]/gu, '')
    .replace(/ /g, '-');
}

export function collectAnchors(content) {
  const anchors = new Set();
  const counts = new Map();
  const addHeading = (text) => {
    const base = slugify(text);
    const seen = counts.get(base) ?? 0;
    counts.set(base, seen + 1);
    anchors.add(seen === 0 ? base : `${base}-${seen}`);
  };
  let previous = null;
  for (const { text } of proseLines(content)) {
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
    previous = text.trim() === '' || /^ {0,3}([>*+-]|\d+[.)])\s/.test(text) ? null : text;
  }
  return anchors;
}

export function splitTarget(target) {
  const hash = target.indexOf('#');
  const path = hash === -1 ? target : target.slice(0, hash);
  const anchor = hash === -1 ? null : target.slice(hash + 1);
  return {
    path: decode(path.replace(/\?.*$/, '')),
    anchor: anchor === null ? null : decode(anchor),
  };
}

function decode(value) {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}

export function resolveTarget(fromFile, path) {
  if (path === '') return fromFile;
  const resolved = path.startsWith('/')
    ? normalize(path.slice(1))
    : normalize(join(dirname(fromFile), path));
  return resolved === '.' ? '' : resolved.replace(/\/$/, '');
}

export function isCheckable(target) {
  return (
    target !== '' &&
    target !== '...' &&
    !target.includes('{{') &&
    !SCHEME.test(target) &&
    !target.startsWith('//')
  );
}

/**
 * Checks every link in `content`, read from repository-relative `file`.
 * `readFile(path)` returns a file's text or null when it does not exist; `isFile(path)` says
 * whether an existing path is a file.
 */
export function checkFile(file, content, { exists, isFile, readFile }) {
  const problems = [];
  for (const { target, line } of extractLinks(content)) {
    if (!isCheckable(target)) continue;
    const { path, anchor } = splitTarget(target);
    const resolved = resolveTarget(file, path);
    if (resolved.startsWith('..')) {
      problems.push({ file, line, target, reason: 'points outside the repository' });
      continue;
    }
    if (resolved !== '' && !exists(resolved)) {
      problems.push({ file, line, target, reason: 'file not found' });
      continue;
    }
    if (!anchor || !MARKDOWN_EXTENSION.test(resolved) || !isFile(resolved)) continue;
    const anchors = collectAnchors(readFile(resolved));
    if (!anchors.has(anchor) && !anchors.has(anchor.toLowerCase())) {
      problems.push({ file, line, target, reason: `no heading #${anchor}` });
    }
  }
  return problems;
}

export function formatProblem({ file, line, target, reason }) {
  return `${file}:${line}: ${target} (${reason})`;
}

function main() {
  const files = execFileSync('git', ['ls-files', '-z', '*.md', '*.mdc'], {
    cwd: REPO_ROOT,
    encoding: 'utf8',
  })
    .split('\0')
    .filter((file) => file !== '' && !isExcluded(file));
  const cache = new Map();
  const absolute = (path) => join(REPO_ROOT, path);
  const io = {
    exists: (path) => existsSync(absolute(path)),
    isFile: (path) => statSync(absolute(path)).isFile(),
    readFile: (path) => {
      if (!cache.has(path)) cache.set(path, readFileSync(absolute(path), 'utf8'));
      return cache.get(path);
    },
  };
  const problems = files
    .filter((file) => io.exists(file))
    .flatMap((file) => checkFile(file, io.readFile(file), io));
  for (const problem of problems) console.error(formatProblem(problem));
  if (problems.length > 0) {
    console.error(
      `\n${problems.length} broken link(s) in ${relative(process.cwd(), REPO_ROOT) || '.'}`,
    );
    process.exit(1);
  }
}

if (import.meta.url === `file://${process.argv[1]}`) {
  main();
}
