import { readdir, readFile } from 'node:fs/promises';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  createOfflineProject,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  removeOfflineProjects,
  resetRenderContractDtsMock,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;
const HASH_OTHER = `dead${'2'.repeat(60)}`;

const NO_DATABASE_CHANGE =
  'The contract changed, but migration plan found nothing to change in the database. That is expected after a Prisma upgrade that changes how contract.json records values, after you switch a field to another codec of the same type, or after you change a control policy.';
const REPORT_IT =
  'If you expected the database to change, migration plan missed it: report it with the output of `prisma migration plan --json`.';

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function cli(project: OfflineProject) {
  return createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: offlineConfig({ project, script: { operations: [] } }),
  });
}

async function run(project: OfflineProject, args: readonly string[]) {
  const result = await cli(project).run([...args, '--json'], { cwd: project.dir });
  const terminal = result.json.at(-1);
  return {
    exitCode: result.exitCode,
    envelope: terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined,
  };
}

function planningFailed(conflict: { kind: string; summary: string; why: string }) {
  return {
    exitCode: 2,
    envelope: {
      ok: false,
      error: {
        code: 'MIGRATION.PLANNING_FAILED',
        summary: 'Migration planning failed',
        why: conflict.summary,
        nextActions: [{ kind: 'user-choice', label: conflict.why }],
        meta: { conflicts: [conflict] },
      },
    },
  };
}

async function migrationsOf(project: OfflineProject) {
  const dirs = (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs');
  return Promise.all(
    dirs.map(async (dir) => {
      const metadata = JSON.parse(
        await readFile(join(project.appMigrationsDir, dir, 'migration.json'), 'utf-8'),
      );
      return { from: metadata.from, to: metadata.to };
    }),
  );
}

/** The database sits at HASH_FROM, which a migration reaches; the emitted contract is HASH_TO. */
async function projectWithHistory(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_FROM,
  });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

describe('migration plan when the planner produces no operations', () => {
  it('names the earlier contract, and migration new --from accepts it', async () => {
    const project = await projectWithHistory();
    const fix = `If you deploy with migrations, run \`prisma migration new --from ${HASH_FROM}\` to write a migration with no operations, then \`prisma db migrate\`. If you manage the database with \`prisma db init\` or \`prisma db update\`, run \`prisma db sign\` on each database instead. ${REPORT_IT}`;

    const plan = await run(project, ['migration', 'plan']);
    const scaffold = await run(project, ['migration', 'new', '--from', HASH_FROM]);

    expect(plan).toMatchObject(
      planningFailed({ kind: 'noDatabaseChange', summary: NO_DATABASE_CHANGE, why: fix }),
    );
    expect({ exitCode: scaffold.exitCode, migrations: await migrationsOf(project) }).toEqual({
      exitCode: 0,
      migrations: expect.arrayContaining([{ from: HASH_FROM, to: HASH_TO }]),
    });
  });

  it('leaves out migration new when --to names the destination', async () => {
    const project = await projectWithHistory();
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260102T0000_other',
      from: HASH_FROM,
      to: HASH_OTHER,
    });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_OTHER });
    const fix = `If you manage the database with \`prisma db init\` or \`prisma db update\`, run \`prisma db sign\` on each database. ${REPORT_IT}`;

    expect(await run(project, ['migration', 'plan', '--to', HASH_OTHER])).toMatchObject(
      planningFailed({ kind: 'noDatabaseChange', summary: NO_DATABASE_CHANGE, why: fix }),
    );
  });

  it('says a first contract has nothing to create, and migration new writes the first migration', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const plan = await run(project, ['migration', 'plan']);
    const scaffold = await run(project, ['migration', 'new']);

    expect(plan).toMatchObject(
      planningFailed({
        kind: 'nothingToCreate',
        summary:
          'This contract describes nothing migration plan can create, so there is no first migration to plan.',
        why: 'If the database needs something the contract does not describe, run `prisma migration new`, add its operations to the new `migration.ts`, then run `node migration.ts` in that directory to write `ops.json`.',
      }),
    );
    expect({ exitCode: scaffold.exitCode, migrations: await migrationsOf(project) }).toEqual({
      exitCode: 0,
      migrations: [{ from: null, to: HASH_TO }],
    });
  });

  it('says the db ref contract has no baseline to plan, without sending the user to migration new', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

    const plan = await run(project, ['migration', 'plan']);
    const scaffold = await run(project, ['migration', 'new']);

    expect(plan).toMatchObject(
      planningFailed({
        kind: 'nothingToBaseline',
        summary: `The migrations directory is empty, so migration plan starts the migration history with a baseline migration to the contract the db ref points at, ${HASH_FROM}. That contract describes nothing migration plan can create, so there is no baseline to plan.`,
        why: 'No command writes a baseline migration with no operations. If you manage the database with `prisma db init` or `prisma db update`, keep using `prisma db update`. To start a migration history from this database, report it with the output of `prisma migration plan --json`.',
      }),
    );
    expect(scaffold).toMatchObject({
      exitCode: 2,
      envelope: { ok: false, error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH' } },
    });
  });
});
