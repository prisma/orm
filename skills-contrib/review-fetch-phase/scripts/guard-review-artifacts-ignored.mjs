#!/usr/bin/env node

import { spawnSync } from 'node:child_process';
import { existsSync, realpathSync } from 'node:fs';
import { basename, isAbsolute, join, relative, resolve, sep, dirname } from 'node:path';
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
 * The workspace root jj reports for the process working directory, or null
 * when jj is unavailable or the working directory is not in a jj workspace.
 */
function findJjWorkspaceRoot() {
  const result = spawnSync('jj', ['workspace', 'root', '--ignore-working-copy'], {
    encoding: 'utf8',
  });
  if (result.status !== 0) {
    return null;
  }
  const root = result.stdout.trim();
  return root === '' ? null : root;
}

/**
 * The canonical form of `path`: symlinks resolved in the part of it that
 * exists, with the components that do not exist yet appended unchanged.
 */
function canonicalize(path) {
  const missing = [];
  let current = resolve(path);
  for (;;) {
    if (existsSync(current)) {
      return join(realpathSync(current), ...missing.reverse());
    }
    const parent = dirname(current);
    if (parent === current) {
      return resolve(path);
    }
    missing.push(basename(current));
    current = parent;
  }
}

function isInside(parentPath, childPath) {
  const relativePath = relative(parentPath, childPath);
  return (
    relativePath !== '' &&
    relativePath !== '..' &&
    !relativePath.startsWith(`..${sep}`) &&
    !isAbsolute(relativePath)
  );
}

/**
 * In a Jujutsu workspace with no git directory, git cannot answer whether a
 * path is ignored. The repo ignores its whole `wip/` tree, so an artifact dir
 * under `<workspace-root>/wip/` is covered by construction — that is what this
 * checks, and it is the only case it accepts.
 *
 * Both sides are canonicalized first: a symlink under `wip/` points at a
 * directory the ignore rule does not cover, so the comparison has to be made
 * between real paths.
 */
function ensureUnderIgnoredWipTree(path) {
  const absolutePath = resolve(path);
  const workspaceRoot = findJjWorkspaceRoot();
  if (workspaceRoot === null) {
    throw new Error('error: not in a git repository or a jj workspace');
  }
  const wipRoot = join(workspaceRoot, 'wip');
  const canonicalWorkspaceRoot = canonicalize(workspaceRoot);
  const canonicalPath = canonicalize(absolutePath);
  if (!isInside(canonicalWorkspaceRoot, canonicalPath)) {
    throw new Error(
      `error: review artifacts must stay inside the workspace: ${absolutePath} resolves to ${canonicalPath}, outside ${canonicalWorkspaceRoot}`,
    );
  }
  if (!isInside(canonicalize(wipRoot), canonicalPath)) {
    throw new Error(
      `error: without git, review artifacts must live under the ignored wip/ tree: ${wipRoot}`,
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
