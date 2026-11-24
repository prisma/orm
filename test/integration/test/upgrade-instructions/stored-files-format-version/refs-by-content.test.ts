import { afterAll, describe, expect, it } from 'vitest';
import {
  changedList,
  emptyProject,
  readTree,
  removeWorkDirs,
  runScript,
  type Tree,
  writeFile,
} from './test-helpers';

afterAll(removeWorkDirs);

const NOTHING_CHANGED = 'Every stored file already has a format version; nothing changed.\n';

describe('a ref file outside a folder the script knows is a migrations folder', () => {
  const HASH = '269d0430c7c70fa502e75feb52d9219c0339daa041c6cc9fb4ecb5ad8d0373b6';

  function runOnProject(files: Tree): {
    readonly run: ReturnType<typeof runScript>;
    readonly tree: Tree;
  } {
    const root = emptyProject();
    for (const [path, content] of Object.entries(files)) writeFile(root, path, content);
    return { run: runScript(root), tree: readTree(root) };
  }

  it('rewrites the refs of an application whose snapshots folder was deleted and which has no migration', () => {
    const { run, tree } = runOnProject({
      'migrations/app/refs/db.json': `{\n  "hash": "${HASH}",\n  "invariants": []\n}\n`,
      'migrations/app/refs/fresh.json': '{"hash":"empty","note":"new","invariants":["seeded"]}\n',
    });
    expect({ run, tree }).toEqual({
      run: {
        status: 0,
        stdout: `Added the format version to 2 files:\n${changedList(['migrations/app/refs/db.json', 'migrations/app/refs/fresh.json'])}Removed the fields a ref file does not have, which earlier releases ignored and dropped when they wrote the ref again:\n  migrations/app/refs/fresh.json: "note"\n`,
        stderr: '',
      },
      tree: {
        'migrations/app/refs/db.json': `{\n  "formatVersion": 1,\n  "hash": "${HASH}",\n  "invariants": []\n}\n`,
        'migrations/app/refs/fresh.json':
          '{"formatVersion":1,"hash":"empty","invariants":["seeded"]}\n',
      },
    });
  });

  it('rewrites the application ref when an extension space next to it has migrations', () => {
    const { run, tree } = runOnProject({
      'migrations/app/refs/db.json': `{"hash":"${HASH}","invariants":[],"policies":{}}\n`,
      'migrations/pgvector/20260101T0000_init/migration.json': `{"formatVersion":1,"from":null,"to":"${HASH}","migrationHash":"m","providedInvariants":[],"createdAt":"c"}\n`,
      'migrations/pgvector/20260101T0000_init/ops.json': '[]\n',
      'migrations/pgvector/refs/head.json': `{"hash":"${HASH}","invariants":[]}\n`,
    });
    expect({
      run,
      app: tree['migrations/app/refs/db.json'],
      extension: tree['migrations/pgvector/refs/head.json'],
    }).toEqual({
      run: {
        status: 0,
        stdout: `Added the format version to 2 files:\n${changedList(['migrations/app/refs/db.json', 'migrations/pgvector/refs/head.json'])}`,
        stderr: '',
      },
      app: `{"formatVersion":1,"hash":"${HASH}","invariants":[],"policies":{}}\n`,
      extension: `{"formatVersion":1,"hash":"${HASH}","invariants":[]}\n`,
    });
  });

  it('leaves a JSON file in a refs folder alone when its content is not a ref', () => {
    const files = {
      'test/fixtures/refs/user.json': '{"name":"Ada"}\n',
      'test/fixtures/refs/short-hash.json': '{"hash":"abc123","invariants":[]}\n',
      'test/fixtures/refs/no-invariants.json': `{"hash":"${HASH}"}\n`,
      'test/fixtures/refs/numbers.json': `{"hash":"${HASH}","invariants":[1]}\n`,
      'test/fixtures/refs/list.json': '["Ada"]\n',
    };
    expect(runOnProject(files)).toEqual({
      run: { status: 0, stdout: NOTHING_CHANGED, stderr: '' },
      tree: files,
    });
  });
});
