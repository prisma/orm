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

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function plannerWithNoOperations(project: OfflineProject) {
  return createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: offlineConfig({ project, script: { operations: [] } }),
  });
}

async function runPlan(project: OfflineProject) {
  const run = await plannerWithNoOperations(project).run(['migration', 'plan', '--json'], {
    cwd: project.dir,
  });
  const terminal = run.json.at(-1);
  return {
    exitCode: run.exitCode,
    envelope: terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined,
  };
}

describe('migration plan when the planner produces no operations', () => {
  it('explains a contract change that needs no database change and names the earlier contract', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
    const why =
      'The contract changed, but migration plan found nothing to change in the database. That is expected after a Prisma upgrade that changes how contract.json records values, after you switch a field to another codec of the same type, or after you change a control policy.';
    const fix = `If you deploy with migrations, run \`prisma migration new --from ${HASH_FROM}\` to write a migration with no operations, then \`prisma db migrate\`. If you manage the database with \`prisma db init\` or \`prisma db update\`, run \`prisma db sign\` on each database instead. If you expected the database to change, migration plan missed it: report it with the output of \`prisma migration plan --json\`.`;

    expect(await runPlan(project)).toMatchObject({
      exitCode: 2,
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.PLANNING_FAILED',
          summary: 'Migration planning failed',
          why,
          nextActions: [{ kind: 'user-choice', label: fix }],
          meta: { conflicts: [{ kind: 'unsupportedChange', summary: why, why: fix }] },
        },
      },
    });
  });

  it('explains that a first contract with nothing to create has no first migration', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    const why =
      'This contract describes nothing migration plan can create, so there is no first migration to plan.';
    const fix =
      'If the database needs something the contract does not describe, such as a database extension, run `prisma migration new`, add its operations to the new `migration.ts`, then run `node migration.ts` in that directory to write `ops.json`.';

    expect(await runPlan(project)).toMatchObject({
      exitCode: 2,
      envelope: {
        ok: false,
        error: {
          code: 'MIGRATION.PLANNING_FAILED',
          summary: 'Migration planning failed',
          why,
          nextActions: [{ kind: 'user-choice', label: fix }],
          meta: { conflicts: [{ kind: 'unsupportedChange', summary: why, why: fix }] },
        },
      },
    });
  });
});
