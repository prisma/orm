#!/usr/bin/env node

import { realpathSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { assertReviewStateV2, REVIEW_STATE_VERSION } from './review-artifacts.mjs';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = { inPath: null, help: false };
  if (args.includes('--help')) {
    result.help = true;
    return result;
  }

  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== '--in') {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    index += 1;
    if (index >= args.length) {
      throw { code: EXIT_CLI, message: 'error: --in requires a value' };
    }
    result.inPath = args[index];
  }

  if (!result.inPath) {
    throw { code: EXIT_CLI, message: 'error: --in is required' };
  }
  if (!result.inPath.endsWith('.json')) {
    throw { code: EXIT_CLI, message: 'error: --in file path must end with .json' };
  }

  return result;
}

function getHelpText() {
  return [
    'Usage:',
    '  validate-review-state.mjs --in <review-state.json>',
    '',
    'Purpose:',
    `  Validate canonical review-state.json schema (v${REVIEW_STATE_VERSION}).`,
  ].join('\n');
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  const raw = await readFile(args.inPath, 'utf8');
  const parsed = JSON.parse(raw);
  assertReviewStateV2(parsed);
  process.stdout.write(`ok: ${args.inPath}\n`);
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
