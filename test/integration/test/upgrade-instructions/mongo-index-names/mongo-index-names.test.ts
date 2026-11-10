import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdtempSync,
  readdirSync,
  readFileSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { dirname, join, relative } from 'pathe';
import { afterAll, describe, expect, it } from 'vitest';

const SCRIPT_PATHS = {
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.22-to-8.0.0-rc.23/scripts/mongo-index-names/mongo-index-names.ts',
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
          'migrations/snapshots/c608a6990faced294eef8a9279dfbd595662d77dea731ff3a0f11ad3cc33795a/contract.json\n' +
          'migrations/snapshots/c608a6990faced294eef8a9279dfbd595662d77dea731ff3a0f11ad3cc33795a/contract.json: the index on { legacy: 1 } in collection "Post" is in no emitted contract under .; named legacy_1 after its keys.\n' +
          'Rewrote 1 file.\n',
        stderr: '',
      },
      tree: readTree(join(fixtures, 'prisma6-project', 'after')),
    });
  });
});

describe('projects whose snapshots hold an index on a collection of the same name', () => {
  const root = copyFixture('before', 'two-projects');
  const result = run(root);

  it("names each snapshot's indexes from its own project's emitted contract, and says which it named after their keys", () => {
    expect({ result, tree: readTree(root) }).toEqual({
      result: {
        status: 0,
        stdout:
          'app-a/migrations/snapshots/aaaa/contract.json\n' +
          'app-b/migrations/snapshots/bbbb/contract.json\n' +
          'app-c/migrations/snapshots/cccc/contract.json\n' +
          'app-a/migrations/snapshots/aaaa/contract.json: the index on { nickname: 1 } in collection "users" is in no emitted contract under app-a; named nickname_1 after its keys.\n' +
          'app-c/migrations/snapshots/cccc/contract.json: the index on { email: 1 } in collection "users" is named admin_email and by_email by the emitted contracts under app-c; named email_1 after its keys.\n' +
          'Rewrote 3 files.\n',
        stderr: '',
      },
      tree: readTree(join(fixtures, 'two-projects', 'after')),
    });
  });
});

describe('a monorepo project whose contract was never re-emitted, beside a project that names the same index', () => {
  const packageFolders = ['.', 'apps/web', 'apps/admin'];
  const packageJsonFiles = Object.fromEntries(
    packageFolders.map((folder) => [join(folder, 'package.json'), '{ "private": true }\n']),
  );
  const root = copyFixture('before', 'monorepo');
  for (const [path, content] of Object.entries(packageJsonFiles))
    writeFileSync(join(root, path), content);
  const result = run(root);
  const snapshot = 'apps/web/migrations/snapshots/wwww/contract.json';

  it("names the snapshot's index after its keys and says so, not taking the other project's name", () => {
    expect({ result, tree: readTree(root) }).toEqual({
      result: {
        status: 0,
        stdout:
          `${snapshot}\n` +
          `${snapshot}: the index on { email: 1 } in collection "users" is in no emitted contract under apps/web; named email_1 after its keys.\n` +
          'Rewrote 1 file.\n',
        stderr: '',
      },
      tree: { ...readTree(join(fixtures, 'monorepo', 'after')), ...packageJsonFiles },
    });
  });
});

describe('a project whose migrations folder is a symbolic link', () => {
  const root = copyFixture('after');
  const target = copyFixture('before');
  symlinkSync(join(target, 'migrations'), join(root, 'linked-migrations'));
  const result = run(root);

  it('names the link, exits 1, and leaves the folder it points to alone', () => {
    expect({ result, target: readTree(target) }).toEqual({
      result: {
        status: 1,
        stdout: 'Nothing to change.\n',
        stderr:
          'linked-migrations: is a symbolic link, so the script did not read it; if it holds migration snapshots, run the script on the folder it points to.\n',
      },
      target: readTree(join(fixtures, 'project', 'before')),
    });
  });
});
