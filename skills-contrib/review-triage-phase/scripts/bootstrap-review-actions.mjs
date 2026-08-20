#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReviewStateV2 } from '../../review-fetch-phase/scripts/review-artifacts.mjs';
import { assertReviewActionsV1 } from './review-artifacts.mjs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

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

  if (!result.inPath || !result.outPath) {
    throw { code: EXIT_CLI, message: 'error: --in and --out are required' };
  }
  if (!result.inPath.endsWith('.json') || !result.outPath.endsWith('.json')) {
    throw { code: EXIT_CLI, message: 'error: --in and --out must be .json paths' };
  }
  return result;
}

function getHelpText() {
  return [
    'Usage:',
    '  bootstrap-review-actions.mjs --in <review-state.json> --out <review-actions.json>',
    '',
    'Purpose:',
    '  Generate deterministic triage scaffolding with one action per review target.',
  ].join('\n');
}

function formatCanonicalJson(value) {
  return `${JSON.stringify(value, null, 2)}\n`;
}

function toActionFromTarget(target, order) {
  return {
    actionId: `A${String(order).padStart(2, '0')}_${target.nodeId}`,
    target: {
      kind: target.kind,
      nodeId: target.nodeId,
      url: target.url ?? null,
    },
    source: {
      targetKey: target.targetKey,
      path: target.path ?? null,
      startLine: target.startLine ?? null,
      endLine: target.endLine ?? null,
      isOutdated: Boolean(target.isOutdated),
      isActionableCandidate: Boolean(target.isActionableCandidate),
      primaryCommentNodeId: target.primaryCommentNodeId ?? null,
      primaryCommentAuthorLogin: target.primaryCommentAuthorLogin ?? null,
      primaryCommentCreatedAt: target.primaryCommentCreatedAt ?? null,
    },
    decision: 'triage_pending',
    summary: null,
    rationale: null,
    targetFiles: target.path ? [target.path] : [],
    acceptance: null,
    status: 'pending',
    done: null,
  };
}

const IMPLEMENT_PHASE_SUPPORTED_TARGET_KINDS = new Set(['review_thread', 'pull_request_review']);

function buildReviewActions(reviewState, reviewStatePath) {
  const supportedTargets = reviewState.targets.filter((target) =>
    IMPLEMENT_PHASE_SUPPORTED_TARGET_KINDS.has(target.kind),
  );
  const actions = supportedTargets.map((target, index) => toActionFromTarget(target, index + 1));

  return {
    version: 2,
    pr: {
      url: reviewState.pr.url,
      nodeId: reviewState.pr.nodeId,
    },
    reviewState: {
      path: reviewStatePath,
      fetchedAt: reviewState.fetchedAt,
      version: reviewState.version,
    },
    actions,
  };
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  const raw = await readFile(args.inPath, 'utf8');
  const reviewState = JSON.parse(raw);
  assertReviewStateV2(reviewState);

  const reviewActions = buildReviewActions(reviewState, args.inPath);
  assertReviewActionsV1(reviewActions);

  await mkdir(dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, formatCanonicalJson(reviewActions), 'utf8');
}

const isMain = (() => {
  try {
    const invokedScriptPath = process.argv[1] ? realpathSync(resolve(process.argv[1])) : null;
    const currentModulePath = realpathSync(fileURLToPath(import.meta.url));
    return invokedScriptPath !== null && invokedScriptPath === currentModulePath;
  } catch {
    return false;
  }
})();

if (isMain) {
  main().catch((error) => {
    const code = typeof error?.code === 'number' ? error.code : EXIT_OPERATIONAL;
    const message = error?.message ? String(error.message) : String(error);
    process.stderr.write(`${message}\n`);
    process.exit(code);
  });
}
