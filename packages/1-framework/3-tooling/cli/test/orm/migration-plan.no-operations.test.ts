import { readdir, readFile } from 'node:fs/promises';
import { writeRef } from '@internal/migration-tools/refs';
import { join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { BIN_GROUPS } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  ADDITIVE_OP,
  createOfflineProject,
  type FixtureStorageNamespaces,
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

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function cli(project: OfflineProject, options: { readonly storageAsClassInstance?: boolean } = {}) {
  return createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: offlineConfig({ project, script: { operations: [] }, ...options }),
  });
}

async function run(
  project: OfflineProject,
  args: readonly string[],
  options: { readonly storageAsClassInstance?: boolean } = {},
) {
  const result = await cli(project, options).run([...args, '--json'], { cwd: project.dir });
  const terminal = result.json.at(-1);
  return {
    exitCode: result.exitCode,
    envelope: terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined,
    data: result.presented?.data,
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
      const packageDir = join(project.appMigrationsDir, dir);
      const metadata = JSON.parse(await readFile(join(packageDir, 'migration.json'), 'utf-8'));
      const ops = JSON.parse(await readFile(join(packageDir, 'ops.json'), 'utf-8'));
      return { from: metadata.from, to: metadata.to, ops };
    }),
  );
}

const STORAGE_FROM: FixtureStorageNamespaces = {
  public: {
    entries: {
      table: { posts: { columns: { id: 'int' } }, users: { columns: { id: 'int' } } },
      valueSet: { Status: { values: ['open'] } },
    },
  },
};

const STORAGE_TO: FixtureStorageNamespaces = {
  public: {
    entries: {
      table: { posts: { columns: { id: 'int' } }, users: { columns: { id: 'int', note: 'text' } } },
      valueSet: { Role: { values: ['admin'] } },
    },
  },
};

const CHANGED_ELEMENT_COORDINATES = [
  { plane: 'storage', namespaceId: 'public', entityKind: 'table', entityName: 'users' },
  { plane: 'storage', namespaceId: 'public', entityKind: 'valueSet', entityName: 'Role' },
  { plane: 'storage', namespaceId: 'public', entityKind: 'valueSet', entityName: 'Status' },
];

const NO_OPERATIONS_TEXT =
  'The storage the contract describes changed, but the database needs no operation for it, so the migration has none. What changed: table "public.users", value set "public.Role", value set "public.Status".';
const NO_OPERATIONS_SUMMARY = `Planned 0 operation(s). ${NO_OPERATIONS_TEXT}`;

/** The database sits at HASH_FROM, which a migration reaches; the emitted contract is HASH_TO. */
async function projectWithHistory(): Promise<OfflineProject> {
  const project = await createOfflineProject({
    storageHash: HASH_TO,
    storageNamespaces: STORAGE_TO,
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
    storageNamespaces: STORAGE_FROM,
  });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

const NOTHING_TO_CREATE =
  'This contract describes nothing migration plan can create, so there is no first migration to plan.';

/** Records HASH_OTHER as the contract of a `target` ref, so `--to target` names it. */
async function seedOtherContract(project: OfflineProject): Promise<void> {
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_OTHER,
    storageNamespaces: STORAGE_TO,
  });
  await writeRef(join(project.appMigrationsDir, 'refs'), 'target', {
    hash: HASH_OTHER,
    invariants: [],
  });
}

/** An empty migrations directory whose db ref points at HASH_FROM. */
async function projectWithDbRefOnly(): Promise<OfflineProject> {
  const project = await createOfflineProject({
    storageHash: HASH_TO,
    storageNamespaces: STORAGE_TO,
  });
  await seedContractSnapshot({
    migrationsDir: project.migrationsDir,
    storageHash: HASH_FROM,
    storageNamespaces: STORAGE_FROM,
  });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
  return project;
}

function writtenWithNoOperations(to: string) {
  return {
    exitCode: 0,
    data: {
      ok: true,
      noOp: false,
      from: HASH_FROM,
      to,
      operations: [],
      changedStorageEntities: CHANGED_ELEMENT_COORDINATES,
      summary: NO_OPERATIONS_SUMMARY,
    },
  };
}

describe('migration plan when the planner produces no operations', () => {
  describe('from an earlier contract', () => {
    it('writes a migration with no operations and names what changed in storage', async () => {
      const project = await projectWithHistory();

      const plan = await run(project, ['migration', 'plan']);

      expect(plan).toMatchObject(writtenWithNoOperations(HASH_TO));
      expect(await migrationsOf(project)).toEqual(
        expect.arrayContaining([{ from: HASH_FROM, to: HASH_TO, ops: [] }]),
      );
    });

    it.each([
      { storage: 'plain JSON', storageAsClassInstance: false },
      { storage: 'a class instance, as real families hydrate it', storageAsClassInstance: true },
    ])(
      'names the storage keys that changed when no storage entity did, with storage as $storage',
      async ({ storageAsClassInstance }) => {
        const project = await createOfflineProject({
          storageHash: HASH_TO,
          storageNamespaces: STORAGE_FROM,
          storageTypes: { Short: { codecId: 'sql/varchar@1' } },
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
          storageNamespaces: STORAGE_FROM,
        });
        await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

        expect(await run(project, ['migration', 'plan'], { storageAsClassInstance })).toMatchObject(
          {
            exitCode: 0,
            data: {
              changedStorageEntities: [],
              summary:
                'Planned 0 operation(s). The storage the contract describes changed, but the database needs no operation for it, so the migration has none. No storage entity changed; what changed is storage.types.',
            },
          },
        );
      },
    );

    it('names what changed in storage for a migration with operations too, and does not warn', async () => {
      const project = await projectWithHistory();
      const harness = createOrmTestCli({
        commands: OFFLINE_COMMANDS,
        groups: BIN_GROUPS,
        orm: offlineConfig({ project, script: { operations: [ADDITIVE_OP] } }),
      });

      const plan = await harness.run(['migration', 'plan'], {
        cwd: project.dir,
        isTty: { stdout: true },
      });

      expect({
        data: plan.presented?.data,
        summary: plan.presented?.presentation.human.find((block) => block.kind === 'summary'),
      }).toMatchObject({
        data: {
          noOp: false,
          operations: [expect.objectContaining({ id: ADDITIVE_OP.id })],
          changedStorageEntities: CHANGED_ELEMENT_COORDINATES,
          summary: 'Planned 1 operation(s)',
        },
        summary: { status: 'ok' },
      });
    });

    it('says so in a warning, above the contract edge', async () => {
      const project = await projectWithHistory();

      const plan = await cli(project).run(['migration', 'plan'], {
        cwd: project.dir,
        isTty: { stdout: true },
      });

      expect(plan.presented?.presentation.human).toContainEqual({
        kind: 'summary',
        status: 'warn',
        text: NO_OPERATIONS_SUMMARY,
      });
    });

    it('writes the delta after an automatic baseline with no operations', async () => {
      const project = await projectWithDbRefOnly();
      const harness = createOrmTestCli({
        commands: OFFLINE_COMMANDS,
        groups: BIN_GROUPS,
        orm: offlineConfig({ project, script: { operationsByPlan: [[ADDITIVE_OP], []] } }),
      });

      const plan = await harness.run(['migration', 'plan', '--json'], { cwd: project.dir });

      expect({ exitCode: plan.exitCode, data: plan.presented?.data }).toMatchObject({
        exitCode: 0,
        data: {
          from: HASH_FROM,
          to: HASH_TO,
          operations: [],
          changedStorageEntities: CHANGED_ELEMENT_COORDINATES,
          summary: `Planned baseline (1 operation(s)) + 0 operation(s). ${NO_OPERATIONS_TEXT}`,
        },
      });
      expect(await migrationsOf(project)).toEqual(
        expect.arrayContaining([
          { from: null, to: HASH_FROM, ops: [expect.objectContaining({ id: ADDITIVE_OP.id })] },
          { from: HASH_FROM, to: HASH_TO, ops: [] },
        ]),
      );
    });

    it('writes a migration with no operations to the --to target', async () => {
      const project = await projectWithHistory();
      await seedMigrationPackage({
        appMigrationsDir: project.appMigrationsDir,
        dirName: '20260102T0000_other',
        from: HASH_FROM,
        to: HASH_OTHER,
      });
      await seedOtherContract(project);

      expect(await run(project, ['migration', 'plan', '--to', 'target'])).toMatchObject(
        writtenWithNoOperations(HASH_OTHER),
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
          why: 'If the database needs something the contract does not describe, run `prisma migration new`, add its operations to the new `migration.ts`, then run that `migration.ts` with `node` to write `ops.json`.',
        }),
      );
      expect({ exitCode: scaffold.exitCode, migrations: await migrationsOf(project) }).toEqual({
        exitCode: 0,
        migrations: [{ from: null, to: HASH_TO, ops: [] }],
      });
    });

    it('says migration new writes only to the emitted contract when --to names the destination', async () => {
      const project = await createOfflineProject({ storageHash: HASH_TO });
      await seedOtherContract(project);

      expect(await run(project, ['migration', 'plan', '--to', 'target'])).toMatchObject(
        planningFailed({
          kind: 'nothingToCreate',
          summary: NOTHING_TO_CREATE,
          why: '`prisma migration new` writes a migration only to the emitted contract. If the database needs something this contract does not describe, emit it, run `prisma migration new`, add its operations to the new `migration.ts`, then run that `migration.ts` with `node` to write `ops.json`.',
        }),
      );
    });
  });

  describe('toward the db ref contract on an empty migrations directory', () => {
    it('writes a baseline with no operations, then the delta', async () => {
      const project = await projectWithDbRefOnly();

      const plan = await run(project, ['migration', 'plan']);

      expect(plan).toMatchObject({
        exitCode: 0,
        data: { from: HASH_FROM, to: HASH_TO, baselineOperations: [] },
      });
      expect(await migrationsOf(project)).toEqual(
        expect.arrayContaining([
          { from: null, to: HASH_FROM, ops: [] },
          { from: HASH_FROM, to: HASH_TO, ops: [] },
        ]),
      );
    });
  });
});
