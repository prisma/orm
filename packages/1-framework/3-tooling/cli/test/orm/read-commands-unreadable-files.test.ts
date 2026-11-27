import { readFile, writeFile } from 'node:fs/promises';
import { ContractValidationError } from '@internal/contract/contract-validation-error';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { offlineConfig, removeOfflineProjects } from './fixtures/offline-project';
import {
  DIR_BASE,
  DIR_HEAD,
  driverConfig,
  fakeDatabase,
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
