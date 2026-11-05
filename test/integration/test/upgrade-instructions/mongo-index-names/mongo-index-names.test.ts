import { spawnSync } from 'node:child_process';
import { cpSync, mkdtempSync, readdirSync, readFileSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT_PATHS = {
  app: 'upgrade-instructions/pending/mongo-index-names/app/scripts/mongo-index-names.ts',
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
const fixtures = join(here, 'fixtures');
const script = join(repoRoot, SCRIPT_PATHS.app);
const workDirs: string[] = [];

afterAll(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function copyFixture(side: 'before' | 'after', project = 'project'): string {
  const root = mkdtempSync(join(tmpdir(), 'mongo-index-names-'));
  workDirs.push(root);
  cpSync(join(fixtures, project, side), root, { recursive: true });
  return root;
}

function readTree(root: string, dir = root): Record<string, string> {
  const files: Record<string, string> = {};
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const path = join(dir, entry.name);
    if (entry.isDirectory()) Object.assign(files, readTree(root, path));
    else if (entry.isFile()) files[relative(root, path)] = readFileSync(path, 'utf8');
  }
  return files;
}

function run(root: string) {
  const result = spawnSync(process.execPath, [script, root], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

const snapshot =
  'migrations/snapshots/406b672b68a6b01f04c0d6f910f5fefa4ac16d48b26e6c91b43856cd42c8cc5d';

describe('a MongoDB project with a re-emitted contract and a snapshot whose indexes have no names', () => {
  const root = copyFixture('before');
  const result = run(root);

  it('rewrites the snapshot and prints the files it changed', () => {
    expect(result).toEqual({
      status: 0,
      stdout: `${snapshot}/contract.json\n${snapshot}/contract.d.ts\nRewrote 2 files.\n`,
      stderr: '',
    });
  });

  it('names each snapshot index after its keys, and leaves the emitted and SQL contracts alone', () => {
    expect(readTree(root)).toEqual(readTree(join(fixtures, 'project', 'after')));
  });

  it('changes nothing on a second run', () => {
    expect(run(root)).toEqual({ status: 0, stdout: 'Nothing to change.\n', stderr: '' });
  });
});

describe('a project read with prisma6Schema() whose snapshot indexes have no names', () => {
  const root = copyFixture('before', 'prisma6-project');
  const result = run(root);

  it('names each snapshot index as the emitted contract names the same index, and after its keys otherwise', () => {
    expect({ result, tree: readTree(root) }).toEqual({
      result: {
        status: 0,
        stdout:
          'migrations/snapshots/c608a6990faced294eef8a9279dfbd595662d77dea731ff3a0f11ad3cc33795a/contract.json\nRewrote 1 file.\n',
        stderr: '',
      },
      tree: readTree(join(fixtures, 'prisma6-project', 'after')),
    });
  });
});
