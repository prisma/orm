import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';

export const SCRIPT_PATHS = {
  app: 'upgrade-instructions/pending/contract-hash-inputs/app/scripts/contract-hash-inputs/contract-hash-inputs.ts',
  extension:
    'upgrade-instructions/pending/contract-hash-inputs/extension/scripts/contract-hash-inputs/contract-hash-inputs.ts',
} as const;

export type Audience = keyof typeof SCRIPT_PATHS;

const here = dirname(fileURLToPath(import.meta.url));
export const repoRoot = join(here, '../../../../..');
export const fixturesDir = join(here, 'fixtures');
const workDirs: string[] = [];

export type Tree = Record<string, string>;
export type Side = 'before' | 'after';

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
  return Object.fromEntries(Object.entries(files).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)));
}

export function fixtureTree(side: Side, project = ''): Tree {
  return readTree(join(fixturesDir, side, project));
}

/** A copy of the `before` or `after` fixture, or of one of its projects, in a new temporary directory. */
export function copyFixture(side: Side, project = ''): string {
  return copyDirectory(join(fixturesDir, side, project));
}

/** A copy of `dir` in a new temporary directory. */
export function copyDirectory(dir: string): string {
  const root = mkdtempSync(join(tmpdir(), 'contract-hash-inputs-'));
  workDirs.push(root);
  cpSync(dir, root, { recursive: true });
  return root;
}

export function editFile(root: string, path: string, edit: (text: string) => string): void {
  const file = join(root, path);
  const text = readFileSync(file, 'utf8');
  const next = edit(text);
  if (next === text) throw new Error(`The edit changed nothing in ${path}`);
  writeFileSync(file, next);
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

/** Runs the script and stops it, as a crash would, just before the `skip`-th file operation whose `<write|rename|remove> <path>` matches `pattern`. */
export function runScriptStoppedBefore(root: string, pattern: string, skip = 0): Run {
  const result = spawnSync(
    process.execPath,
    ['--import', join(here, 'stop-before.mjs'), join(repoRoot, SCRIPT_PATHS.app), root],
    { encoding: 'utf8', env: { ...process.env, STOP_BEFORE: pattern, STOP_SKIP: String(skip) } },
  );
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function copyInto(root: string, side: Side, from: string, to: string): void {
  cpSync(join(fixturesDir, side, from), join(root, to), { recursive: true });
}
