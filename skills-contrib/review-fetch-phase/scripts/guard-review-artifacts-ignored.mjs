#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const EXIT_SUCCESS = 0;
const EXIT_OPERATIONAL = 1;
const EXIT_CLI = 2;

const RELATIVE_ARTIFACT_PATHS = [
  'review-state.json',
  'review-state.md',
  'summary.txt',
  'review-targets.json',
  'review-actions.json',
  'review-actions.md',
];

function parseCliArgs(argv) {
  const args = argv.slice(2);
  const result = { outputDir: null, help: false };
  if (args.includes('--help')) {
    result.help = true;
    return result;
  }
  for (let index = 0; index < args.length; index += 1) {
    const arg = args[index];
    if (arg !== '--dir') {
      throw { code: EXIT_CLI, message: `error: unknown flag "${arg}"` };
    }
    index += 1;
    if (index >= args.length) {
      throw { code: EXIT_CLI, message: 'error: --dir requires a value' };
    }
    result.outputDir = args[index];
  }
  if (!result.outputDir) {
    throw { code: EXIT_CLI, message: 'error: --dir is required' };
  }
  return result;
}

function getHelpText() {
  return [
    'Usage:',
    '  guard-review-artifacts-ignored.mjs --dir <output-dir>',
    '',
    'Purpose:',
    '  Fail fast if generated review artifacts are not git-ignored.',
  ].join('\n');
}

function runGitCheckIgnore(path) {
  const result = spawnSync('git', ['check-ignore', '--quiet', path], { encoding: 'utf8' });
  return result.status === 0;
}

function isTracked(path) {
  const result = spawnSync('git', ['ls-files', '--error-unmatch', path], { encoding: 'utf8' });
  return result.status === 0;
}

/**
 * The workspace root of a Jujutsu workspace, found by walking up to the `.jj`
 * directory. Returns null outside one.
 */
function findJjWorkspaceRoot(startPath) {
  let current = resolve(startPath);
  for (;;) {
    if (existsSync(join(current, '.jj'))) {
      return current;
    }
    const parent = dirname(current);
    if (parent === current) {
      return null;
    }
    current = parent;
  }
}

/**
 * In a Jujutsu workspace with no git directory, git cannot answer whether a
 * path is ignored. The repo ignores its whole `wip/` tree, so an artifact dir
 * under `<workspace-root>/wip/` is covered by construction — that is what this
 * checks, and it is the only case it accepts.
 */
function ensureUnderIgnoredWipTree(path) {
  const absolutePath = resolve(path);
  const workspaceRoot = findJjWorkspaceRoot(absolutePath);
  if (workspaceRoot === null) {
    throw new Error('error: not in a git repository or a jj workspace');
  }
  const relativePath = relative(join(workspaceRoot, 'wip'), absolutePath);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(
      `error: without git, review artifacts must live under the ignored wip/ tree: ${join(workspaceRoot, 'wip')}`,
    );
  }
  return true;
}

function ensureInsideRepo(path) {
  const root = spawnSync('git', ['rev-parse', '--show-toplevel'], { encoding: 'utf8' });
  if (root.status !== 0) {
    return ensureUnderIgnoredWipTree(path);
  }
  const repoRoot = root.stdout.trim();
  const absolutePath = resolve(path);
  const relativePath = relative(repoRoot, absolutePath);
  if (
    relativePath === '' ||
    relativePath === '..' ||
    relativePath.startsWith(`..${sep}`) ||
    isAbsolute(relativePath)
  ) {
    throw new Error(`error: output dir must be inside repo: ${repoRoot}`);
  }
  return false;
}

async function main() {
  const args = parseCliArgs(process.argv);
  if (args.help) {
    process.stdout.write(`${getHelpText()}\n`);
    process.exit(EXIT_SUCCESS);
  }

  const ignoredByWorkspaceLayout = ensureInsideRepo(args.outputDir);
  if (ignoredByWorkspaceLayout) {
    process.stdout.write(
      `ok: review artifacts are under the ignored wip/ tree: ${args.outputDir}\n`,
    );
    process.exit(EXIT_SUCCESS);
  }

  const tracked = [];
  const notIgnored = [];
  for (const relativePath of RELATIVE_ARTIFACT_PATHS) {
    const fullPath = join(args.outputDir, relativePath);
    if (isTracked(fullPath)) {
      tracked.push(fullPath);
      continue;
    }
    const ignored = runGitCheckIgnore(fullPath);
    if (!ignored) {
      notIgnored.push(fullPath);
    }
  }

  if (tracked.length > 0) {
    process.stderr.write(
      `error: review artifacts are tracked in git and must be untracked first:\n${tracked
        .map((path) => `- ${path}`)
        .join('\n')}\n`,
    );
    process.stderr.write(
      'hint: run `git rm --cached <paths>` once, then keep them ignored via .gitignore.\n',
    );
    process.exit(EXIT_OPERATIONAL);
  }

  if (notIgnored.length > 0) {
    process.stderr.write(
      `error: review artifacts must be git-ignored. Missing ignore coverage for:\n${notIgnored
        .map((path) => `- ${path}`)
        .join('\n')}\n`,
    );
    process.exit(EXIT_OPERATIONAL);
  }

  process.stdout.write('ok: review artifact paths are ignored by git\n');
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
