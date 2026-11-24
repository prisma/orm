import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';

export const SCRIPT_PATHS = {
  app: 'upgrade-instructions/pending/stored-files-format-version/app/scripts/stored-files-format-version/stored-files-format-version.ts',
  extension:
    'upgrade-instructions/pending/stored-files-format-version/extension/scripts/stored-files-format-version/stored-files-format-version.ts',
} as const;

export const GUIDE_PATHS = {
  app: 'upgrade-instructions/pending/stored-files-format-version/app/instructions.md',
  extension: 'upgrade-instructions/pending/stored-files-format-version/extension/instructions.md',
} as const;

export type Audience = keyof typeof SCRIPT_PATHS;

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '../../../../..');
export const fixturesDir = join(here, 'fixtures');
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
  const root = mkdtempSync(join(tmpdir(), 'stored-files-format-version-'));
  workDirs.push(root);
  cpSync(join(fixturesDir, side), root, { recursive: true });
  return root;
}

export interface Run {
  readonly status: number | null;
  readonly stdout: string;
  readonly stderr: string;
}

export function runScript(root: string, audience: Audience = 'app'): Run {
  const result = spawnSync(process.execPath, [join(repoRoot, SCRIPT_PATHS[audience]), root], {
    encoding: 'utf8',
  });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}
