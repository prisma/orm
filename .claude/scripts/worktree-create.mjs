#!/usr/bin/env node

import { execSync } from 'node:child_process';
import { copyFileSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { text } from 'node:stream/consumers';

const input = JSON.parse(await text(process.stdin));

const name = input.name;
const cwd = input.cwd;

const dir = resolve(cwd, '.claude/worktrees', name);

execSync('git fetch origin +main:refs/remotes/origin/main', {
  stdio: 'ignore',
  cwd,
});

execSync(`git worktree add -b "worktree/${name}" "${dir}" origin/main`, {
  stdio: 'ignore',
  cwd,
});

const preamble = `# Worktree Boundary

You are operating inside a worktree at \`${dir}\`.

**Do not** read, write, explore, or execute anything outside of this directory.
All file paths must be within \`${dir}\`.
`;

let existing = '';
try {
  existing = readFileSync(resolve(cwd, 'CLAUDE.local.md'), 'utf8');
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

const content = existing ? `${preamble}\n${existing}` : preamble;
writeFileSync(resolve(dir, 'CLAUDE.local.md'), content);

try {
  copyFileSync(
    resolve(cwd, '.claude/settings.local.json'),
    resolve(dir, '.claude/settings.local.json'),
  );
} catch (err) {
  if (err.code !== 'ENOENT') throw err;
}

execSync('pnpm install', { stdio: 'ignore', cwd: dir });
execSync('pnpm build', {
  stdio: 'ignore',
  cwd: dir,
});

console.log(dir);
