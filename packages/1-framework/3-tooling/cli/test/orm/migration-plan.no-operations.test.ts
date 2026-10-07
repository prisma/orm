import { readdir, readFile } from 'node:fs/promises';
import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  ADDITIVE_OP,
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

const NOTHING_TO_CREATE =
  'This contract describes nothing migration plan can create, so there is no first migration to plan.';
const NOTHING_TO_BASELINE = {
  kind: 'nothingToBaseline',
  summary: `The migrations directory is empty, so migration plan starts the migration history with a baseline migration to the contract the db ref points at, ${HASH_FROM}. That contract describes nothing migration plan can create, so there is no baseline to plan.`,
  why: 'No command writes a baseline migration with no operations. If you manage the database with `prisma db init` or `prisma db update`, keep using `prisma db update`. No command can start a migration history from this database yet; report it with the output of `prisma migration plan --json`.',
};

/** Records HASH_OTHER as the contract of a `target` ref, so `--to target` names it. */
async function seedOtherContract(project: OfflineProject): Promise<void> {
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_OTHER });
  await writeRef(join(project.appMigrationsDir, 'refs'), 'target', {
    hash: HASH_OTHER,
    invariants: [],
  });
}

/** An empty migrations directory whose db ref points at HASH_FROM. */
async function projectWithDbRefOnly(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

describe('migration plan when the planner produces no operations', () => {
  describe('from an earlier contract', () => {
    const fix = `If you deploy with migrations, run \`prisma migration new --from ${HASH_FROM}\` to write a migration with no operations, then \`prisma db migrate\`. If you manage the database with \`prisma db init\` or \`prisma db update\`, run \`prisma db sign\` on each database instead. ${REPORT_IT}`;

    it('names the earlier contract, and migration new --from accepts it', async () => {
      const project = await projectWithHistory();

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

    it('gives the same advice when the delta after an automatic baseline has no operations', async () => {
      const project = await projectWithDbRefOnly();
      const harness = createOrmTestCli({
        commands: OFFLINE_COMMANDS,
        groups: BIN_GROUPS,
        orm: offlineConfig({ project, script: { operationsByPlan: [[ADDITIVE_OP], []] } }),
      });

      const plan = await harness.run(['migration', 'plan', '--json'], { cwd: project.dir });
      const terminal = plan.json.at(-1);
      const scaffold = await run(project, ['migration', 'new', '--from', HASH_FROM]);

      expect({
        exitCode: plan.exitCode,
        envelope:
          terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined,
      }).toMatchObject(
        planningFailed({ kind: 'noDatabaseChange', summary: NO_DATABASE_CHANGE, why: fix }),
      );
      expect({ exitCode: scaffold.exitCode, migrations: await migrationsOf(project) }).toEqual({
        exitCode: 0,
        migrations: expect.arrayContaining([
          { from: null, to: HASH_FROM },
          { from: HASH_FROM, to: HASH_TO },
        ]),
      });
    });

    it('names db sign with the --to target and leaves out migration new', async () => {
      const project = await projectWithHistory();
      await seedMigrationPackage({
        appMigrationsDir: project.appMigrationsDir,
        dirName: '20260102T0000_other',
        from: HASH_FROM,
        to: HASH_OTHER,
      });
      await seedOtherContract(project);

      expect(await run(project, ['migration', 'plan', '--to', 'target'])).toMatchObject(
        planningFailed({
          kind: 'noDatabaseChange',
          summary: NO_DATABASE_CHANGE,
          why: `\`prisma migration new\` writes a migration only to the emitted contract; to write one to this target, emit it first. If you manage the database with \`prisma db init\` or \`prisma db update\`, run \`prisma db sign ${HASH_OTHER}\` on each database. ${REPORT_IT}`,
        }),
      );
    });
  });

  describe('with no earlier contract', () => {
    it('says a first contract has nothing to create, and migration new writes the first migration', async () => {
      const project = await createOfflineProject({ storageHash: HASH_TO });

      const plan = await run(project, ['migration', 'plan']);
      const scaffold = await run(project, ['migration', 'new']);

      expect(plan).toMatchObject(
        planningFailed({
          kind: 'nothingToCreate',
          summary: NOTHING_TO_CREATE,
          why: 'If the database needs something the contract does not describe, run `prisma migration new`, add its operations to the new `migration.ts`, then run `node migration.ts` in that directory to write `ops.json`.',
        }),
      );
      expect({ exitCode: scaffold.exitCode, migrations: await migrationsOf(project) }).toEqual({
        exitCode: 0,
        migrations: [{ from: null, to: HASH_TO }],
      });
    });

    it('says migration new writes only to the emitted contract when --to names the destination', async () => {
      const project = await createOfflineProject({ storageHash: HASH_TO });
      await seedOtherContract(project);

      expect(await run(project, ['migration', 'plan', '--to', 'target'])).toMatchObject(
        planningFailed({
          kind: 'nothingToCreate',
          summary: NOTHING_TO_CREATE,
          why: '`prisma migration new` writes a migration only to the emitted contract. If the database needs something this contract does not describe, emit it, run `prisma migration new`, add its operations to the new `migration.ts`, then run `node migration.ts` in that directory to write `ops.json`.',
        }),
      );
    });
  });

  describe('toward the db ref contract on an empty migrations directory', () => {
    it('says there is no baseline to plan, without sending the user to migration new', async () => {
      const project = await projectWithDbRefOnly();

      const plan = await run(project, ['migration', 'plan']);
      const scaffold = await run(project, ['migration', 'new']);

      expect(plan).toMatchObject(planningFailed(NOTHING_TO_BASELINE));
      expect(scaffold).toMatchObject({
        exitCode: 2,
        envelope: { ok: false, error: { code: 'MIGRATION.HASH_NOT_IN_GRAPH' } },
      });
    });

    it('gives the same advice when --to names the destination', async () => {
      const project = await projectWithDbRefOnly();
      await seedOtherContract(project);

      expect(await run(project, ['migration', 'plan', '--to', 'target'])).toMatchObject(
        planningFailed(NOTHING_TO_BASELINE),
      );
    });
  });
});
