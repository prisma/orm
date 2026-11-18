#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReviewStateV2 } from './review-artifacts.mjs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

function getHelpText() {
  return [
    'Usage:',
    '  render-review-state.mjs --in <review-state.json> [--out <review-state.md>|-] [--help]',
    '',
    'Purpose:',
    '  Render deterministic Markdown (review-state.md) from review-state.json.',
    '',
    'Flags:',
    '  --in <path.json>       Input path to review-state.json.',
    '  --out <path.md>|-      Markdown output path. Use "-" to write to stdout. Defaults to stdout.',
    '  --help                 Show this help text and exit.',
  ].join('\n');
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = { inPath: null, outPath: null, help: false };
  if (args.includes('--help')) {
    result.help = true;
    return result;
  }

  const knownFlags = new Set(['--in', '--out']);
  let index = 0;
  while (index < args.length) {
    const arg = args[index];
    if (!arg.startsWith('--') || !knownFlags.has(arg)) {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }

    index += 1;
    if (index >= args.length) {
      throw { code: EXIT_CLI, message: `error: ${arg} requires a value` };
    }

    const value = args[index];
    if (arg === '--in') {
      result.inPath = value;
    } else if (arg === '--out') {
      result.outPath = value;
    }
    index += 1;
  }

  if (!result.inPath) {
    throw { code: EXIT_CLI, message: 'error: --in is required' };
  }
  if (result.inPath === '-') {
    throw { code: EXIT_CLI, message: 'error: --in - is not supported' };
  }
  if (result.inPath !== '-' && !result.inPath.endsWith('.json')) {
    throw { code: EXIT_CLI, message: 'error: --in file path must end with .json' };
  }
  if (result.outPath !== null && result.outPath !== '-' && !result.outPath.endsWith('.md')) {
    throw { code: EXIT_CLI, message: 'error: --out file path must end with .md' };
  }

  return result;
}

function escapeTableCell(value) {
  return String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\\/g, '\\\\')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
}

function formatCodeSpan(value) {
  const text = String(value ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\|/g, '\\|')
    .replace(/\s+/g, ' ')
    .trim();
  const longestBacktickRun = (text.match(/`+/g) ?? []).reduce(
    (max, run) => Math.max(max, run.length),
    0,
  );
  const fence = '`'.repeat(longestBacktickRun + 1);
  const pad = text.startsWith('`') || text.endsWith('`') ? ' ' : '';
  return `${fence}${pad}${text}${pad}${fence}`;
}

function formatLines(startLine, endLine) {
  if (Number.isInteger(startLine) && Number.isInteger(endLine)) {
    return `${startLine}-${endLine}`;
  }
  if (Number.isInteger(startLine)) {
    return String(startLine);
  }
  if (Number.isInteger(endLine)) {
    return String(endLine);
  }
  return '';
}

function summarizeBody(body, maxLength = 180) {
  const normalized = String(body ?? '')
    .replace(/\r?\n/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  if (normalized.length <= maxLength) {
    return normalized;
  }
  return `${normalized.slice(0, maxLength - 1)}…`;
}

function formatAuthorLogin(author) {
  return typeof author?.login === 'string' && author.login.length > 0 ? author.login : '<deleted>';
}

export function renderReviewStateMarkdown(payload, { sourcePath }) {
  assertReviewStateV2(payload);

  const source = formatCodeSpan(sourcePath || 'review-state.json');
  const lines = [];

  lines.push('# Review State');
  lines.push('');
  lines.push(`PR: ${escapeTableCell(payload.pr.url)}`);
  lines.push(`Source: ${source}`);
  lines.push(`FetchedAt: ${escapeTableCell(payload.fetchedAt)}`);
  lines.push(`SourceBranch: ${escapeTableCell(payload.sourceBranch)}`);
  lines.push('');
  lines.push(`Unresolved threads: ${payload.reviewThreads.length}`);
  lines.push(`Reviews with body: ${payload.reviews.length}`);
  lines.push(`Issue comments: ${payload.issueComments.length}`);
  lines.push('');

  lines.push('## Unresolved Review Threads');
  lines.push('');
  lines.push('| Node ID | Path | Lines | Outdated | Comments | Primary comment |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const thread of payload.reviewThreads) {
    const primaryComment = thread.comments[0];
    lines.push(
      [
        escapeTableCell(thread.nodeId),
        escapeTableCell(thread.path),
        escapeTableCell(formatLines(thread.startLine, thread.endLine)),
        thread.isOutdated ? 'yes' : 'no',
        escapeTableCell(thread.comments.length),
        escapeTableCell(summarizeBody(primaryComment?.body ?? '')),
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    );
  }
  lines.push('');

  lines.push('## Reviews With Body');
  lines.push('');
  lines.push('| Node ID | Author | State | Submitted At | URL | Body excerpt |');
  lines.push('| --- | --- | --- | --- | --- | --- |');
  for (const review of payload.reviews) {
    lines.push(
      [
        escapeTableCell(review.nodeId),
        escapeTableCell(formatAuthorLogin(review.author)),
        escapeTableCell(review.state),
        escapeTableCell(review.submittedAt),
        escapeTableCell(review.url),
        escapeTableCell(summarizeBody(review.body)),
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    );
  }
  lines.push('');

  lines.push('## Issue Comments');
  lines.push('');
  lines.push('| Node ID | Author | Created At | URL | Body excerpt |');
  lines.push('| --- | --- | --- | --- | --- |');
  for (const comment of payload.issueComments) {
    lines.push(
      [
        escapeTableCell(comment.nodeId),
        escapeTableCell(formatAuthorLogin(comment.author)),
        escapeTableCell(comment.createdAt),
        escapeTableCell(comment.url),
        escapeTableCell(summarizeBody(comment.body)),
      ]
        .join(' | ')
        .replace(/^/, '| ')
        .replace(/$/, ' |'),
    );
  }
  return `${lines.join('\n')}\n`;
}

async function readJson(path) {
  const raw = await readFile(path, 'utf8');
  return JSON.parse(raw);
}

async function writeOutput(outPath, text) {
  if (!outPath || outPath === '-') {
    process.stdout.write(text);
    return;
  }
  await mkdir(dirname(outPath), { recursive: true });
  await writeFile(outPath, text, 'utf8');
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  const payload = await readJson(args.inPath);
  const markdown = renderReviewStateMarkdown(payload, { sourcePath: args.inPath });
  await writeOutput(args.outPath, markdown);
}

function safeRealpath(path) {
  try {
    return realpathSync(path);
  } catch {
    return null;
  }
}

const invokedScriptPath = process.argv[1] ? safeRealpath(resolve(process.argv[1])) : null;
const currentModulePath = safeRealpath(fileURLToPath(import.meta.url));
const isMain =
  invokedScriptPath !== null &&
  currentModulePath !== null &&
  invokedScriptPath === currentModulePath;

if (isMain) {
  main().catch((error) => {
    const code = typeof error?.code === 'number' ? error.code : EXIT_OPERATIONAL;
    const message = error?.message ? String(error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(code);
  });
}

export { parseCliArgs };
