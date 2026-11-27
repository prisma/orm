import { readFile, writeFile } from 'node:fs/promises';
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { offlineConfig, removeOfflineProjects, seedDbRef } from './fixtures/offline-project';
import {
  DIR_BASE,
  DIR_HEAD,
  driverConfig,
  fakeDatabase,
  HASH_BASE,
  HASH_HEAD,
  harness,
  markersAt,
  projectWithTwoMigrations,
} from './fixtures/status-database';

afterEach(removeOfflineProjects);

async function addUnknownKey(path: string): Promise<void> {
  const json = JSON.parse(await readFile(path, 'utf-8'));
  await writeFile(path, JSON.stringify({ ...json, zzz: 1 }), 'utf-8');
}

async function projectWithUnreadableHead() {
  const project = await projectWithTwoMigrations();
  await addUnknownKey(join(project.appMigrationsDir, DIR_HEAD, 'migration.json'));
  return project;
}

const unreadableHead = expect.objectContaining({
  code: 'MIGRATION.CHECK_PACKAGE_UNLOADABLE',
  severity: 'warn',
  summary: expect.stringMatching(new RegExp(`${DIR_HEAD}.*zzz must be removed`)),
});

describe('a read command meets a migration.json it cannot read', () => {
  it('migration list reports it and still lists the other migrations', async () => {
    const project = await projectWithUnreadableHead();

    const run = await harness(offlineConfig({ project })).run(['migration', 'list', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.diagnostics).toEqual([unreadableHead]);
    expect(run.presented?.data).toMatchObject({
      spaces: [{ space: 'app', migrations: [expect.objectContaining({ name: DIR_BASE })] }],
    });
  });

  it('migration graph reports it and still draws the other migrations', async () => {
    const project = await projectWithUnreadableHead();

    const run = await harness(offlineConfig({ project })).run(['migration', 'graph', '--json'], {
      cwd: project.dir,
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.diagnostics).toEqual([unreadableHead]);
  });

  it('migration show names why the migration it is asked for cannot be read', async () => {
    const project = await projectWithUnreadableHead();

    const run = await harness(offlineConfig({ project })).run(
      ['migration', 'show', DIR_HEAD, '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.CONTRACT_SPACE_VIOLATION',
          why: expect.stringMatching(new RegExp(`${DIR_HEAD}.*zzz must be removed`)),
        },
      },
    });
  });
});

describe('migration status meets a contract.json the family refuses', () => {
  it('reports the refusal as an unreadable contract and still exits 0', async () => {
    const project = await projectWithTwoMigrations();
    await addUnknownKey(project.contractPath);
    const db = fakeDatabase({ markers: markersAt(HASH_HEAD) });
    const strict = {
      ...db,
      familyInstance: {
        ...db.familyInstance,
        deserializeContract: (json: unknown) => {
          if (json !== null && typeof json === 'object' && 'zzz' in json) {
            throw new ContractValidationError('zzz must be removed', 'structural');
          }
          return json;
        },
      },
    };

    const run = await harness(driverConfig(project, strict)).run(
      ['migration', 'status', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.diagnostics).toEqual([
      expect.objectContaining({
        code: 'CONTRACT.UNREADABLE',
        severity: 'warn',
        summary: expect.stringContaining('zzz must be removed'),
      }),
    ]);
  });
});

function strictFamily(db: ReturnType<typeof fakeDatabase>) {
  return {
    ...db,
    familyInstance: {
      ...db.familyInstance,
      deserializeContract: (json: unknown) => {
        if (json !== null && typeof json === 'object' && 'zzz' in json) {
          throw new ContractValidationError('zzz must be removed', 'structural');
        }
        return json;
      },
    },
  };
}

describe('a listing meets a ref it cannot read', () => {
  async function projectWithUnreadableRef() {
    const project = await projectWithTwoMigrations();
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_HEAD });
    await addUnknownKey(join(project.appMigrationsDir, 'refs', 'db.json'));
    return project;
  }

  const unreadableRef = expect.objectContaining({
    code: 'MIGRATION.CHECK_REF_UNREADABLE',
    severity: 'warn',
    summary: expect.stringMatching(
      /refs\/db.json: Ref "db" is left out, because it could not be read: .*zzz/,
    ),
  });

  it.each([['list'], ['graph']])(
    'migration %s reports it and still lists the migrations',
    async (command) => {
      const project = await projectWithUnreadableRef();

      const run = await harness(offlineConfig({ project })).run(['migration', command, '--json'], {
        cwd: project.dir,
      });

      expect({ exitCode: run.exitCode, diagnostics: run.presented?.diagnostics }).toEqual({
        exitCode: 0,
        diagnostics: [unreadableRef],
      });
    },
  );

  it('migration status reports it and still answers', async () => {
    const project = await projectWithUnreadableRef();

    const run = await harness(
      driverConfig(project, fakeDatabase({ markers: markersAt(HASH_HEAD) })),
    ).run(['migration', 'status', '--json'], { cwd: project.dir });

    expect({ exitCode: run.exitCode, diagnostics: run.presented?.diagnostics }).toEqual({
      exitCode: 0,
      diagnostics: [unreadableRef],
    });
  });
});

describe('migration status meets a migration.json it cannot read', () => {
  it('reports it and still answers', async () => {
    const project = await projectWithUnreadableHead();

    const run = await harness(
      driverConfig(project, fakeDatabase({ markers: markersAt(HASH_BASE) })),
    ).run(['migration', 'status', '--json'], { cwd: project.dir });

    expect({ exitCode: run.exitCode, diagnostics: run.presented?.diagnostics }).toEqual({
      exitCode: 0,
      diagnostics: [unreadableHead],
    });
  });
});

describe('a listing meets a contract.json the family refuses', () => {
  it.each([['list'], ['graph']])(
    'migration %s reports the refusal and still lists the migrations',
    async (command) => {
      const project = await projectWithTwoMigrations();
      await addUnknownKey(project.contractPath);

      const run = await harness(driverConfig(project, strictFamily(fakeDatabase()))).run(
        ['migration', command, '--json'],
        { cwd: project.dir },
      );

      expect({ exitCode: run.exitCode, diagnostics: run.presented?.diagnostics }).toEqual({
        exitCode: 0,
        diagnostics: [
          expect.objectContaining({
            code: 'CONTRACT.UNREADABLE',
            severity: 'warn',
            summary: expect.stringContaining('zzz must be removed'),
          }),
        ],
      });
    },
  );
});

describe('a command that acts on the migrations meets a migration.json it cannot read', () => {
  it('migration ref set refuses, naming the migration, instead of calling it unknown', async () => {
    const project = await projectWithUnreadableHead();

    const run = await harness(offlineConfig({ project })).run(
      ['migration', 'ref', 'set', 'staging', DIR_HEAD, '--json'],
      { cwd: project.dir },
    );

    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.CONTRACT_SPACE_VIOLATION',
          why: expect.stringMatching(new RegExp(`${DIR_HEAD}.*zzz must be removed`)),
        },
      },
    });
  });
});

describe('a command that resolves a ref it could not read says so, instead of calling it unknown', () => {
  async function projectWithUnreadableProductionRef() {
    const project = await projectWithTwoMigrations();
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_HEAD });
    await writeFile(
      join(project.appMigrationsDir, 'refs', 'production.json'),
      JSON.stringify({ formatVersion: 1, hash: HASH_BASE, invariants: [], zzz: 1 }),
      'utf-8',
    );
    return project;
  }

  it.each([['--to'], ['--from']])(
    'migration status %s production refuses with the file and the reason',
    async (flag) => {
      const project = await projectWithUnreadableProductionRef();

      const run = await harness(
        driverConfig(project, fakeDatabase({ markers: markersAt(HASH_HEAD) })),
      ).run(['migration', 'status', flag, 'production', '--json'], { cwd: project.dir });

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: {
          ok: false,
          error: {
            code: 'MIGRATION.INVALID_REF_FILE',
            why: expect.stringMatching(/refs\/production\.json.*zzz/),
          },
        },
      });
    },
  );

  it('migration check production reports the ref it could not read', async () => {
    const project = await projectWithUnreadableProductionRef();

    const run = await harness(offlineConfig({ project })).run(
      ['migration', 'check', 'production', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(4);
    expect(run.presented?.diagnostics).toEqual([
      expect.objectContaining({ code: 'MIGRATION.CHECK_REF_UNREADABLE' }),
    ]);
  });
});

describe('migration status with a migration it could not read', () => {
  it('does not advise authoring a path that the unread migration may hold', async () => {
    const project = await projectWithUnreadableHead();

    const run = await harness(
      driverConfig(project, fakeDatabase({ markers: markersAt(HASH_BASE) })),
    ).run(['migration', 'status', '--json'], { cwd: project.dir });

    const summary = String((run.presented?.data as { summary?: unknown } | undefined)?.summary);
    expect(summary).not.toContain('to author');
    expect(summary).toContain('could not be read');
  });
});
