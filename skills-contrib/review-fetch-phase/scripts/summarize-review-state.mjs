#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReviewStateV2, formatCanonicalJson } from './review-artifacts.mjs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

function getHelpText() {
  return [
    'Usage:',
    '  summarize-review-state.mjs --in <review-state.json> [--format text|json] [--out <path>|-] [--help]',
    '',
    'Purpose:',
    '  Render deterministic summaries from review-state.json with no network access.',
    '',
    'Flags:',
    '  --in <path.json>        Input path to review-state.json.',
    '  --format text|json      Summary output format. Defaults to text.',
    '  --out <path>|-          Output path. Use "-" to write to stdout. Defaults to stdout.',
    '  --help                  Show this help text and exit.',
  ].join('\n');
}

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = { inPath: null, format: 'text', outPath: null, help: false };
  if (args.includes('--help')) {
    result.help = true;
    return result;
  }

  const knownFlags = new Set(['--in', '--format', '--out']);
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
    } else if (arg === '--format') {
      result.format = value;
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
  if (result.format !== 'text' && result.format !== 'json') {
    throw { code: EXIT_CLI, message: 'error: --format must be text or json' };
  }
  if (result.outPath !== null && result.outPath !== '-') {
    if (result.format === 'json' && !result.outPath.endsWith('.json')) {
      throw {
        code: EXIT_CLI,
        message: 'error: --out file path must end with .json for --format json',
      };
    }
    if (result.format === 'text' && !result.outPath.endsWith('.txt')) {
      throw {
        code: EXIT_CLI,
        message: 'error: --out file path must end with .txt for --format text',
      };
    }
  }

  return result;
}

export function buildReviewStateSummary(payload) {
  assertReviewStateV2(payload);

  return {
    version: 1,
    pr: {
      url: payload.pr.url,
      nodeId: payload.pr.nodeId,
      number: payload.pr.number,
      title: payload.pr.title,
      state: payload.pr.state,
    },
    fetchedAt: payload.fetchedAt,
    sourceBranch: payload.sourceBranch,
    counts: {
      unresolvedThreads: payload.reviewThreads.length,
      reviewsWithBody: payload.reviews.length,
      issueComments: payload.issueComments.length,
    },
    unresolvedThreadNodeIds: payload.reviewThreads.map((thread) => thread.nodeId),
    reviewNodeIds: payload.reviews.map((review) => review.nodeId),
    issueCommentNodeIds: payload.issueComments.map((comment) => comment.nodeId),
  };
}

export function renderReviewStateSummaryText(summary) {
  const lines = [];
  lines.push('Review State Summary');
  lines.push(`PR: ${summary.pr.url ?? ''}`);
  lines.push(`FetchedAt: ${summary.fetchedAt}`);
  lines.push(`SourceBranch: ${summary.sourceBranch ?? ''}`);
  lines.push('');
  lines.push(`Unresolved threads: ${summary.counts.unresolvedThreads}`);
  lines.push(`Reviews with body: ${summary.counts.reviewsWithBody}`);
  lines.push(`Issue comments: ${summary.counts.issueComments}`);
  lines.push('');
  lines.push('Unresolved thread nodeIds:');
  for (const nodeId of summary.unresolvedThreadNodeIds) {
    lines.push(`- ${nodeId}`);
  }
  lines.push('');
  lines.push('Review nodeIds:');
  for (const nodeId of summary.reviewNodeIds) {
    lines.push(`- ${nodeId}`);
  }
  lines.push('');
  lines.push('Issue comment nodeIds:');
  for (const nodeId of summary.issueCommentNodeIds) {
    lines.push(`- ${nodeId}`);
  }
  return `${lines.join('\n')}\n`;
}

export function renderReviewStateSummaryJson(summary) {
  return formatCanonicalJson(summary);
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
  const summary = buildReviewStateSummary(payload);
  const output =
    args.format === 'json'
      ? renderReviewStateSummaryJson(summary)
      : renderReviewStateSummaryText(summary);

  await writeOutput(args.outPath, output);
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
