import { rm } from 'node:fs/promises';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { HASH_FROM, HASH_TO, harness, plannedDirs } from './fixtures/migration-plan-project';
import {
  ADDITIVE_OP,
  createOfflineProject,
  DESTRUCTIVE_OP,
  type FakePlannerScript,
  removeOfflineProjects,
  resetRenderContractDtsMock,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function envelopeOf(run: { readonly json: readonly unknown[] }) {
  const terminal = run.json.at(-1) as
    | { readonly kind: string; readonly envelope?: unknown }
    | undefined;
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

describe('migration plan with a field of a renamed model', () => {
  it('names a field of a renamed model through its new name, and takes a rename written that way', async () => {
    const project = await createOfflineProject({
      storageHash: HASH_TO,
      models: [{ name: 'User', fields: ['id', 'handle'] }],
    });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedContractSnapshot({
      migrationsDir: project.migrationsDir,
      storageHash: HASH_FROM,
      models: [{ name: 'Profile', fields: ['id', 'nickname'] }],
    });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
    const script: FakePlannerScript = {
      operations: [ADDITIVE_OP, DESTRUCTIVE_OP],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'field', namespaceId: 'app', model: 'Profile', field: 'nickname' },
        },
      ],
      statementsResolvingDataLoss: 2,
    };

    const refused = await harness(project, { script }).run(
      ['migration', 'plan', '--rename', 'Profile:User', '--json'],
      { cwd: project.dir },
    );
    expect(
      (envelopeOf(refused) as { readonly error: { readonly nextActions: unknown } }).error
        .nextActions,
    ).toEqual([
      {
        kind: 'user-choice',
        label:
          'If the field was renamed to "handle", keep its values: --rename User.nickname:User.handle',
      },
      { kind: 'user-choice', label: 'If the values can go: --delete User.nickname' },
    ]);

    const deleted = await harness(project, { script }).run(
      ['migration', 'plan', '--rename', 'Profile:User', '--delete', 'User.nickname', '--json'],
      { cwd: project.dir },
    );
    expect(deleted.presented?.data).toMatchObject({
      appliedStatements: [
        { verb: 'rename' },
        { verb: 'delete', description: 'delete field "User.nickname"' },
      ],
    });
    for (const dir of await plannedDirs(project)) {
      if (dir !== '20260101T0000_initial') {
        await rm(join(project.appMigrationsDir, dir), { recursive: true });
      }
    }

    const renamed = await harness(project, { script }).run(
      [
        'migration',
        'plan',
        '--rename',
        'Profile:User',
        '--rename',
        'User.nickname:User.handle',
        '--json',
      ],
      { cwd: project.dir },
    );
    expect(renamed.exitCode).toBe(0);
  });
});
