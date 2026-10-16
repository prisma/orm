import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';

const SCRIPT_PATHS = {
  app: 'upgrade-instructions/pending/data-type-values/app/scripts/data-type-values.ts',
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
export const fixtures = join(here, 'fixtures');
export const appScript = join(repoRoot, SCRIPT_PATHS.app);
const workDirs: string[] = [];

export function removeWorkDirs(): void {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
}

export function makeWorkDir(prefix: string): string {
  const dir = mkdtempSync(join(tmpdir(), prefix));
  workDirs.push(dir);
  return dir;
}

export function readTree(root: string, dir = root): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, readTree(root, path));
    else if (entry.isFile()) files[relative(root, path)] = readFileSync(path, 'utf8');
  }
  return files;
}

export interface Run {
  readonly root: string;
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function copyFixture(name: string, side: 'before' | 'after'): string {
  const root = makeWorkDir(`data-type-values-${name}-`);
  cpSync(join(fixtures, name, side), root, { recursive: true });
  return root;
}

export function runScript(root: string, options: readonly string[] = []): Run {
  const result = spawnSync(process.execPath, [appScript, root, ...options], { encoding: 'utf8' });
  return { root, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function expectedTree(name: string, side: 'before' | 'after'): Record<string, string> {
  return readTree(join(fixtures, name, side));
}

export const OLD_HASH = 'e12144f8cb1dd3d315b65f0098cc5ac938bbb6e4f6706a733a1a9f9194ef614b';
export const NEW_HASH = 'be4174af061494b515cb3031f75051235fd9307ab05a00c78b5b017c1578b32a';
export const ALREADY_IN_NEW_FORM = 'The project is already in the new form; nothing changed.\n';
