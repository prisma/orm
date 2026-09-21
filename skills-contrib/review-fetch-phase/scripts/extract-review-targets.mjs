#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { mkdir, readFile, writeFile } from 'node:fs/promises';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReviewStateV2, formatCanonicalJson } from './review-artifacts.mjs';

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

  if (!result.inPath) {
    throw { code: EXIT_CLI, message: 'error: --in is required' };
  }
  if (!result.outPath) {
    throw { code: EXIT_CLI, message: 'error: --out is required' };
  }
  if (!result.inPath.endsWith('.json') || !result.outPath.endsWith('.json')) {
    throw { code: EXIT_CLI, message: 'error: --in and --out must be .json paths' };
  }
  return result;
}

function getHelpText() {
  return [
    'Usage:',
    '  extract-review-targets.mjs --in <review-state.json> --out <review-targets.json>',
    '',
    'Purpose:',
    '  Build deterministic target index for triage bootstrapping.',
  ].join('\n');
}

function buildTargetsPayload(reviewState, inPath) {
  return {
    version: 1,
    reviewState: {
      path: inPath,
      fetchedAt: reviewState.fetchedAt,
      prUrl: reviewState.pr.url,
      prNodeId: reviewState.pr.nodeId,
    },
    targets: reviewState.targets.map((target, index) => ({
      order: index + 1,
      ...target,
    })),
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
  const payload = buildTargetsPayload(reviewState, args.inPath);
  await mkdir(dirname(args.outPath), { recursive: true });
  await writeFile(args.outPath, formatCanonicalJson(payload), 'utf8');
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
