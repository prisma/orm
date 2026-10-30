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
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.21-to-8.0.0-rc.22/scripts/value-objects-in-storage/value-objects-in-storage.ts',
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
export const fixturesDir = join(here, 'fixtures');
const appScript = join(repoRoot, SCRIPT_PATHS.app);
const workDirs: string[] = [];

export type Tree = Record<string, string>;

export function removeWorkDirs(): void {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
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

export function fixtureTree(side: 'before' | 'after'): Tree {
  return readTree(join(fixturesDir, side));
}

export function copyFixture(side: 'before' | 'after'): string {
  const root = mkdtempSync(join(tmpdir(), 'value-objects-in-storage-'));
  workDirs.push(root);
  cpSync(join(fixturesDir, side), root, { recursive: true });
  return root;
}

export function editJson(
  root: string,
  path: string,
  edit: (json: unknown) => unknown,
  writtenPath = path,
): void {
  const json: unknown = JSON.parse(readFileSync(join(root, path), 'utf8'));
  const target = join(root, writtenPath);
  mkdirSync(dirname(target), { recursive: true });
  writeFileSync(target, `${JSON.stringify(edit(json), null, 2)}\n`);
}

export interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runScript(root: string): Run {
  const result = spawnSync(process.execPath, [appScript, root], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
