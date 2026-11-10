import { spawnSync } from 'node:child_process';
import {
  cpSync,
  mkdirSync,
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
  app: 'skills/prisma-8/upgrading/app/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/scripts/mongo-field-storage-names/mongo-field-storage-names.ts',
  extension:
    'skills/prisma-8/upgrading/extension/upgrades/8.0.0-rc.18-to-8.0.0-rc.19/scripts/mongo-field-storage-names/mongo-field-storage-names.ts',
} as const;

const here = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(here, '../../../../..');
const fixtures = join(here, 'fixtures');
const script = join(repoRoot, SCRIPT_PATHS.app);
const workDirs: string[] = [];

afterAll(() => {
  for (const dir of workDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function workDir(): string {
  const dir = mkdtempSync(join(tmpdir(), 'mongo-field-storage-names-'));
  workDirs.push(dir);
  return dir;
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

function run(...args: string[]) {
  const result = spawnSync(process.execPath, [script, ...args], { encoding: 'utf8' });
  return { status: result.status, stdout: result.stdout, stderr: result.stderr };
}

function copyFixture(side: 'before' | 'after'): string {
  const root = workDir();
  cpSync(join(fixtures, 'project', side), root, { recursive: true });
  return root;
}

const snapshot =
  'migrations/snapshots/62671fbf016c515d808ac613743fddbf3db80384c1997251eac9d6f5fc063590';

describe('a MongoDB project with a re-emitted contract and an old snapshot', () => {
  const root = copyFixture('before');
  const result = run(root);

  it('rewrites the snapshot and prints the files it changed', () => {
    expect(result).toEqual({
      status: 0,
      stdout: `${snapshot}/contract.json\n${snapshot}/contract.d.ts\nRewrote 2 files.\n`,
      stderr: '',
    });
  });

  it('records each field as stored under its own name, and leaves the emitted and SQL contracts alone', () => {
    expect(readTree(root)).toEqual(readTree(join(fixtures, 'project', 'after')));
  });

  it('changes nothing on a second run', () => {
    expect(run(root)).toEqual({
      status: 0,
      stdout: 'Every MongoDB contract already records its stored names; nothing changed.\n',
      stderr: '',
    });
  });
});

describe('the rewritten snapshot', () => {
  const contract = JSON.parse(
    readFileSync(join(fixtures, 'project', 'after', snapshot, 'contract.json'), 'utf8'),
  );
  const before = JSON.parse(
    readFileSync(join(fixtures, 'project', 'before', snapshot, 'contract.json'), 'utf8'),
  );

  it('keeps every field name and stores each under that name', () => {
    expect(contract.domain.namespaces.__unbound__.models.User.storage).toEqual({
      collection: 'users',
      fields: {
        _id: { field: '_id' },
        address: { field: 'address' },
        bio: { field: 'bio' },
        email: { field: 'email' },
        name: { field: 'name' },
        role: { field: 'role' },
      },
    });
  });

  it('keeps the storage section, execution section and hashes', () => {
    expect([contract.storage, contract.execution, contract.profileHash]).toEqual([
      before.storage,
      before.execution,
      before.profileHash,
    ]);
  });
});

describe('a project without a MongoDB contract', () => {
  it('says so and changes nothing', () => {
    const root = workDir();
    writeFileSync(join(root, 'package.json'), '{"name":"app"}\n');
    expect(run(root)).toEqual({
      status: 0,
      stdout: 'No MongoDB contract found under the project root; nothing changed.\n',
      stderr: '',
    });
  });
});

describe('a contract.d.ts whose storage types the script cannot find', () => {
  it('rewrites the contract, says which model to finish by hand, and exits 1', () => {
    const root = copyFixture('before');
    writeFileSync(join(root, snapshot, 'contract.d.ts'), 'export type Contract = unknown;\n');
    const result = run(root);
    expect({ status: result.status, stderr: result.stderr.split('\n').sort() }).toEqual({
      status: 1,
      stderr: [
        '',
        ...['Article', 'Post', 'Tutorial', 'User'].map(
          (model) =>
            `${snapshot}/contract.d.ts: no storage type found for model ${model}; add readonly fields to it by hand`,
        ),
      ],
    });
  });
});

describe('a model with a field named storage', () => {
  it("adds the stored names to the model's own storage type, not the field's", () => {
    const root = workDir();
    const field = { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false };
    writeFileSync(
      join(root, 'contract.json'),
      `${JSON.stringify({
        targetFamily: 'mongo',
        domain: {
          namespaces: {
            __unbound__: {
              models: {
                Box: {
                  fields: { storage: field },
                  relations: {},
                  storage: { collection: 'boxes' },
                },
              },
            },
          },
        },
      })}\n`,
    );
    const declarations = [
      'type ContractBase = {',
      '  readonly models: {',
      '    readonly Box: {',
      "      readonly fields: { readonly storage: { readonly nullable: false; readonly type: { readonly kind: 'scalar'; readonly codecId: 'mongo/string@1' } } };",
      '      readonly relations: Record<string, never>;',
      "      readonly storage: { readonly collection: 'boxes' };",
      '    };',
      '  };',
      '};',
      '',
    ];
    writeFileSync(join(root, 'contract.d.ts'), declarations.join('\n'));
    expect(run(root).status).toBe(0);
    expect(readFileSync(join(root, 'contract.d.ts'), 'utf8')).toBe(
      [
        ...declarations.slice(0, 5),
        "      readonly storage: { readonly collection: 'boxes'; readonly fields: { readonly storage: { readonly field: 'storage' } } };",
        ...declarations.slice(6),
      ].join('\n'),
    );
  });
});

describe('a project with hidden directories and broken links', () => {
  it('skips every directory whose name starts with a dot and every link it cannot follow', () => {
    const root = copyFixture('before');
    const hidden = join(root, '.claude/worktrees/feature');
    mkdirSync(hidden, { recursive: true });
    cpSync(join(root, 'migrations'), join(hidden, 'migrations'), { recursive: true });
    symlinkSync(join(root, 'missing'), join(root, 'dangling'));
    symlinkSync(join(root, 'loop'), join(root, 'loop'));
    symlinkSync(root, join(root, 'prisma', 'cycle'));
    const result = run(root);
    expect({ ...result, tree: readTree(root) }).toEqual({
      status: 0,
      stdout: `${snapshot}/contract.json\n${snapshot}/contract.d.ts\nRewrote 2 files.\n`,
      stderr: '',
      tree: {
        ...readTree(join(fixtures, 'project', 'after')),
        ...Object.fromEntries(
          Object.entries(readTree(join(fixtures, 'project', 'before', 'migrations'))).map(
            ([path, text]) => [`.claude/worktrees/feature/migrations/${path}`, text],
          ),
        ),
      },
    });
  });
});

describe('the arguments', () => {
  it('refuses an option or a project root that is not a directory', () => {
    const missing = join(workDir(), 'missing');
    expect([run('--help'), run(missing)]).toEqual([
      {
        status: 1,
        stdout: '',
        stderr: '--help: unknown option\nUsage: node mongo-field-storage-names.ts [project-root]\n',
      },
      {
        status: 1,
        stdout: '',
        stderr: `${missing}: not a directory\nUsage: node mongo-field-storage-names.ts [project-root]\n`,
      },
    ]);
  });

  it('ships the same script for extensions', () => {
    expect(readFileSync(join(repoRoot, SCRIPT_PATHS.extension), 'utf8')).toBe(
      readFileSync(script, 'utf8'),
    );
  });
});
