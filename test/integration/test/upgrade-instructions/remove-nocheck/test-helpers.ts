import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';

const SCRIPT_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/scripts/remove-nocheck/remove-nocheck.ts',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/scripts/remove-nocheck/remove-nocheck.ts',
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
export const fixturesDir = join(here, 'fixtures');
export const appScript = join(repoRoot, SCRIPT_PATHS.app);
export const extensionScript = join(repoRoot, SCRIPT_PATHS.extension);
const workDirs: string[] = [];

export type Tree = Record<string, string>;

export function removeWorkDirs(): void {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

function makeWorkDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'remove-nocheck-'));
  workDirs.push(dir);
  return dir;
}

export function readTree(root: string, dir = root): Tree {
  const files: Tree = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, readTree(root, path));
    else if (entry.isFile()) files[relative(root, path)] = readFileSync(path, 'utf8');
  }
  return files;
}

export function writeTree(root: string, tree: Tree): void {
  for (const [path, text] of Object.entries(tree)) {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), text);
  }
}

export function copyFixture(side: 'before' | 'after', fixture = 'nocheck'): string {
  const root = makeWorkDir();
  cpSync(join(fixturesDir, fixture, side), root, { recursive: true });
  return root;
}

export interface Run {
  readonly root: string;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runScript(root: string, script = appScript, args: readonly string[] = []): Run {
  const result = spawnSync(process.execPath, [script, root, ...args], {
    encoding: 'utf8',
    env: { ...process.env, NODE_PATH: '' },
  });
  return { root, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function fixtureTree(side: 'before' | 'after', fixture = 'nocheck'): Tree {
  return readTree(join(fixturesDir, fixture, side));
}
