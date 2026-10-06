import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';

const SCRIPT_PATHS = {
  app: 'upgrade-instructions/pending/data-type-in-contract/app/scripts/data-type-in-contract.ts',
  extension:
    'upgrade-instructions/pending/data-type-in-contract/extension/scripts/data-type-in-contract.ts',
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
const fixtures = join(here, 'fixtures');
export const appScript = join(repoRoot, SCRIPT_PATHS.app);
export const extensionScript = join(repoRoot, SCRIPT_PATHS.extension);
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
  const root = makeWorkDir(`data-type-in-contract-${name}-`);
  cpSync(join(fixtures, name, side), root, { recursive: true });
  return root;
}

export function runScript(root: string, script = appScript, options: readonly string[] = []): Run {
  const result = spawnSync(process.execPath, [script, root, ...options], { encoding: 'utf8' });
  return { root, status: result.status, stdout: result.stdout, stderr: result.stderr };
}

export function upgrade(
  name: string,
  side: 'before' | 'after' = 'before',
  script = appScript,
): Run {
  return runScript(copyFixture(name, side), script);
}

export function expectedTree(name: string, side: 'before' | 'after'): Record<string, string> {
  return readTree(join(fixtures, name, side));
}

export const ALREADY_IN_NEW_FORMAT = 'The project is already in the new format; nothing changed.\n';

export function upgradeSummary(
  counts: string,
  hashes: readonly (readonly [string, string])[],
): string {
  return [
    `${counts} Storage hashes changed (old -> new):`,
    ...hashes.map(([oldHash, newHash]) => `  ${oldHash} -> ${newHash}`),
    '',
  ].join('\n');
}

export const POSTGRES_EXTENSION_SPACE_SUMMARY = upgradeSummary(
  'Rewrote 10 files and renamed 3 snapshot directories.',
  [
    [
      '3d2c56a2944685bd21b05bc8a8d73164397df51c014201902932fbe7e80ff1b8',
      '4a96b488a4ce92b434e5f7d6607b6435c0955f0d36b0018077045787764240e6',
    ],
    [
      'eb71bcdad05720d5faa9c875ab24d8e7247fcc24dbc9294d70d170808768f871',
      '99239f90bc2b6bb170c23be0fc3d2b7931e14211777db6d086f3301be62f707b',
    ],
    [
      'ffcb5620e06a06ea2c6dad025087d882406fe4c66a282dbda185b6d54638b155',
      'ab03042a26032f51c0dc4a04e19d96ece877f22a1e876f238327cb21f480d703',
    ],
  ],
);
