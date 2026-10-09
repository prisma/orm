import { existsSync } from 'node:fs';
import { readdir, readFile, rm } from 'node:fs/promises';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { computeMigrationHash } from '@internal/migration-tools/hash';
import { writeRef } from '@internal/migration-tools/refs';
import { notOk } from '@internal/utils/result';
import { structuredError } from '@internal/utils/structured-error';
import { createTestCli } from '@prisma/cli-engine/testing';
import { basename, dirname, join } from 'pathe';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { executeMigrationPlanCommand } from '../../src/control-api/operations/migration-plan';
import type { AnswerPlanQuestions } from '../../src/control-api/statements/plan-questions';
import type { StatementText } from '../../src/control-api/statements/statement-text';
import { BIN_GROUPS } from '../../src/orm/cli';
import { errorUnfilledPlaceholder } from '../../src/utils/cli-errors';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import {
  ADDITIVE_OP,
  contractJson,
  createOfflineProject,
  DESTRUCTIVE_OP,
  type FakePlannerScript,
  OFFLINE_COMMANDS,
  type OfflineProject,
  offlineConfig,
  RENDERED_CONTRACT_DTS,
  removeOfflineProjects,
  renderContractDtsMock,
  resetRenderContractDtsMock,
  seedContractSnapshot,
  seedDbRef,
  seedMigrationPackage,
} from './fixtures/offline-project';

const HASH_TO = `c0ffee${'0'.repeat(58)}`;
const HASH_FROM = `beef${'1'.repeat(60)}`;

beforeEach(resetRenderContractDtsMock);
afterEach(removeOfflineProjects);

function harness(
  project: OfflineProject,
  options: {
    readonly script?: FakePlannerScript;
    readonly overrides?: Record<string, unknown>;
  } = {},
) {
  return createOrmTestCli({
    commands: OFFLINE_COMMANDS,
    groups: BIN_GROUPS,
    orm: {
      ...offlineConfig({ project, ...(options.script ? { script: options.script } : {}) }),
      ...options.overrides,
    },
  });
}

async function plannedDirs(project: OfflineProject): Promise<readonly string[]> {
  return (await readdir(project.appMigrationsDir)).filter((entry) => entry !== 'refs').sort();
}

/** A project whose database sits at HASH_FROM and whose contract is HASH_TO. */
async function plannableProject(): Promise<OfflineProject> {
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

/** A project whose database already sits at the emitted contract. */
async function upToDateProject(): Promise<OfflineProject> {
  const project = await createOfflineProject({ storageHash: HASH_TO });
  await seedMigrationPackage({
    appMigrationsDir: project.appMigrationsDir,
    dirName: '20260101T0000_initial',
    from: null,
    to: HASH_TO,
  });
  await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_TO });
  await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_TO });
  return project;
}

describe('migration plan --config naming a file in a subdirectory', () => {
  it('reads the contract from and plans into the config file directory', async () => {
    const project = await plannableProject();
    const cli = createTestCli({
      commands: OFFLINE_COMMANDS,
      groups: BIN_GROUPS,
      // The engine's own loader: the file's sections exactly as written.
      loadConfig: async (configPath) => ({
        files: [
          {
            path: join(
              project.dir,
              configPath === undefined ? 'prisma.config.ts' : basename(configPath),
            ),
            sections: {
              orm: {
                ...offlineConfig({ project }),
                contract: {
                  source: {
                    format: 'typescript',
                    inputs: [],
                    load: async () => contractJson('unused'),
                  },
                  output: './output/contract.json',
                },
                migrations: { dir: './migrations' },
              },
            },
          },
        ],
        diagnostics: [],
      }),
    });

    const run = await cli.run(
      [
        'migration',
        'plan',
        '--name',
        'add-users',
        '--config',
        join(basename(project.dir), 'prisma.config.ts'),
      ],
      { cwd: dirname(project.dir) },
    );
    const dirs = await plannedDirs(project);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      noOp: false,
      from: HASH_FROM,
      to: HASH_TO,
    });
    expect(dirs).toHaveLength(2);
    expect(dirs.at(-1)).toMatch(/_add_users$/);
  });
});

describe('migration plan', () => {
  it('settles as a completed envelope carrying the plan document', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan', '--name', 'add-users'], {
      cwd: project.dir,
    });
    const dirs = await plannedDirs(project);

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      noOp: false,
      from: HASH_FROM,
      to: HASH_TO,
      dir: join('migrations', 'app', dirs.at(-1) ?? ''),
      operations: [{ id: 'table.user', label: 'Create table "user"', operationClass: 'additive' }],
      emittedExtensionDirs: [],
    });
    expect(dirs.at(-1)).toMatch(/_add_users$/);
  });

  it('presents the header, the planned operations and the contract edge', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan', '--name', 'add-users'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });
    const dir = join('migrations', 'app', (await plannedDirs(project)).at(-1) ?? '');

    expect(run.presented?.presentation.human).toEqual([
      {
        kind: 'fields',
        rail: true,
        rows: [
          { label: 'contract', value: join('output', 'contract.json') },
          { label: 'migrations', value: join('migrations', 'app') },
          { label: 'name', value: 'add-users' },
        ],
      },
      { kind: 'summary', status: 'ok', text: expect.any(String) },
      { kind: 'tree', roots: [{ label: dir, children: [{ label: 'Create table "user"' }] }] },
      {
        kind: 'fields',
        rows: [
          { label: 'from', value: [{ text: HASH_FROM, tone: 'identifier' }] },
          { label: 'to', value: [{ text: HASH_TO, tone: 'identifier' }] },
          { label: 'app space', value: dir },
        ],
      },
    ]);
  });

  it('marks a destructive operation and warns under the tree', async () => {
    const project = await plannableProject();

    const run = await harness(project, {
      script: { operations: [ADDITIVE_OP, DESTRUCTIVE_OP] },
    }).run(['migration', 'plan'], { cwd: project.dir, isTty: { stdout: true } });
    const blocks = run.presented?.presentation.human ?? [];

    expect(blocks[2]).toEqual({
      kind: 'tree',
      roots: [
        {
          label: join('migrations', 'app', (await plannedDirs(project)).at(-1) ?? ''),
          children: [
            { label: 'Create table "user"' },
            { label: 'Drop table "legacy"', status: 'warn' },
          ],
        },
      ],
    });
    expect(blocks[3]).toEqual({
      kind: 'summary',
      status: 'warn',
      text: 'This migration contains destructive operations that may cause data loss.',
    });
  });

  it('names reviewing and applying the migration as the typed next actions', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });
    const dir = join('migrations', 'app', (await plannedDirs(project)).at(-1) ?? '');

    expect(run.presented?.presentation.next).toEqual([
      { kind: 'edit-file', label: `Review ${dir}` },
      { kind: 'run-command', label: 'Apply the migration', command: 'prisma-test db migrate' },
    ]);
  });

  it('reports no changes without writing a package', async () => {
    const project = await upToDateProject();

    const run = await harness(project).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ noOp: true, from: HASH_TO, to: HASH_TO });
    expect(run.presented?.presentation.human.at(1)).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'No changes detected',
    });
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('writes the baseline and delta packages for an auto-baseline plan', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project).run(['migration', 'plan', '--name', 'delta'], {
      cwd: project.dir,
    });
    const dirs = await plannedDirs(project);

    expect(run.exitCode).toBe(0);
    expect(dirs.map((entry) => entry.replace(/^\d+T\d+_/, ''))).toEqual(['baseline', 'delta']);
    expect(run.presented?.data).toMatchObject({
      baselineDir: join('migrations', 'app', dirs[0] ?? ''),
      dir: join('migrations', 'app', dirs[1] ?? ''),
    });
  });

  it('dates the auto-baseline before now and the delta at now', async () => {
    const now = new Date('2026-10-05T11:00:30.000Z');
    vi.useFakeTimers({ now, toFake: ['Date'] });
    try {
      const project = await createOfflineProject({ storageHash: HASH_TO });
      await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
      await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

      await harness(project).run(['migration', 'plan', '--name', 'delta'], { cwd: project.dir });
      const createdAt = await Promise.all(
        (await plannedDirs(project)).map(async (dir) => {
          const manifest = await readFile(
            join(project.appMigrationsDir, dir, 'migration.json'),
            'utf-8',
          );
          return [dir.replace(/^\d+T\d+_/, ''), JSON.parse(manifest).createdAt];
        }),
      );

      expect(createdAt).toEqual([
        ['baseline', '2026-10-05T10:59:30.000Z'],
        ['delta', '2026-10-05T11:00:30.000Z'],
      ]);
    } finally {
      vi.useRealTimers();
    }
  });

  it('warns when the default origin ref already has outgoing edges', async () => {
    const HASH_MID = `abba${'4'.repeat(60)}`;
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260102T0000_second',
      from: HASH_FROM,
      to: HASH_MID,
    });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    const data = run.presented?.data as { warnings?: readonly string[] } | undefined;
    const warnings = data?.warnings ?? [];
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("'db'");
    expect(warnings[0]).toContain(HASH_FROM);
    expect(warnings[0]).toContain(HASH_MID);
    expect(run.presented?.presentation.human).toContainEqual({
      kind: 'summary',
      status: 'warn',
      text: warnings[0],
    });
  });

  it('does not warn when the default origin ref has no outgoing edges', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan'], { cwd: project.dir });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).not.toHaveProperty('warnings');
  });

  describe('forked graph', () => {
    const HASH_OTHER = `dead${'2'.repeat(60)}`;

    /** Two migrations planned off the empty database: HASH_FROM and HASH_OTHER are both tips. */
    async function forkedProject(): Promise<OfflineProject> {
      const project = await createOfflineProject({ storageHash: HASH_TO });
      await seedMigrationPackage({
        appMigrationsDir: project.appMigrationsDir,
        dirName: '20260101T0000_left',
        from: null,
        to: HASH_FROM,
      });
      await seedMigrationPackage({
        appMigrationsDir: project.appMigrationsDir,
        dirName: '20260102T0000_right',
        from: null,
        to: HASH_OTHER,
      });
      await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
      return project;
    }

    it('plans from an explicit ref and writes the edge from that tip', async () => {
      const project = await forkedProject();
      await writeRef(join(project.appMigrationsDir, 'refs'), 'topic', {
        hash: HASH_FROM,
        invariants: [],
      });

      const run = await harness(project).run(
        ['migration', 'plan', '--from', 'topic', '--name', 'delta'],
        { cwd: project.dir },
      );
      const dirs = await plannedDirs(project);
      const planned = dirs.find((dir) => dir.endsWith('_delta'));

      expect(run.exitCode).toBe(0);
      expect(planned).toBeDefined();
      expect(
        JSON.parse(
          await readFile(join(project.appMigrationsDir, planned ?? '', 'migration.json'), 'utf-8'),
        ),
      ).toMatchObject({ from: HASH_FROM, to: HASH_TO });
    });

    it('plans from the db ref without warning when that tip has no outgoing edges', async () => {
      const project = await forkedProject();
      await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

      const run = await harness(project).run(['migration', 'plan', '--name', 'delta'], {
        cwd: project.dir,
      });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({ from: HASH_FROM, to: HASH_TO });
      expect(run.presented?.data).not.toHaveProperty('warnings');
    });

    it('refuses with PLAN_ORIGIN_UNKNOWN when neither --from nor a db ref is given', async () => {
      const project = await forkedProject();

      const run = await harness(project).run(['migration', 'plan', '--name', 'delta', '--json'], {
        cwd: project.dir,
      });

      expect(run.exitCode).toBe(2);
      expect(run.json.at(-1)).toMatchObject({
        kind: 'result',
        envelope: { ok: false, error: { code: 'MIGRATION.PLAN_ORIGIN_UNKNOWN' } },
      });
    });
  });

  describe('data loss', () => {
    const LEGACY_LOSS = {
      operationIndex: 1,
      subject: { kind: 'model', namespaceId: 'app', model: 'Legacy' },
    } as const;
    const AUDIT_LOSS = {
      operationIndex: 2,
      subject: { kind: 'storage', name: 'audit_log' },
    } as const;
    const DROP_AUDIT_OP = {
      ...DESTRUCTIVE_OP,
      id: 'table.drop_audit',
      label: 'Drop table "audit_log"',
    };
    const losingScript: FakePlannerScript = {
      operations: [ADDITIVE_OP, DESTRUCTIVE_OP],
      dataLoss: [LEGACY_LOSS],
    };

    /** A project whose database sits at HASH_FROM, with models Legacy and User, and whose contract is HASH_TO. */
    async function losingProject(): Promise<OfflineProject> {
      const project = await createOfflineProject({
        storageHash: HASH_TO,
        models: ['User', 'Archive'],
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
        models: ['User', 'Legacy'],
      });
      await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
      return project;
    }

    /** An empty graph whose db ref demands a baseline, then a delta that loses data. */
    async function losingBaselineProject(): Promise<OfflineProject> {
      const project = await createOfflineProject({
        storageHash: HASH_TO,
        models: ['User', 'Archive'],
      });
      await seedContractSnapshot({
        migrationsDir: project.migrationsDir,
        storageHash: HASH_FROM,
        models: ['User', 'Legacy'],
      });
      await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });
      return project;
    }

    function envelopeOf(run: { readonly json: readonly unknown[] }) {
      const terminal = run.json.at(-1) as
        | { readonly kind: string; readonly envelope?: unknown }
        | undefined;
      return terminal?.kind === 'result' ? terminal.envelope : undefined;
    }

    function planThroughControlApi(
      project: OfflineProject,
      statements: readonly StatementText[],
      answerQuestions: AnswerPlanQuestions,
    ) {
      return executeMigrationPlanCommand(
        {
          config: {
            ...offlineConfig({
              project,
              script: {
                operations: [ADDITIVE_OP, DESTRUCTIVE_OP, DROP_AUDIT_OP],
                dataLoss: [LEGACY_LOSS, AUDIT_LOSS],
              },
            }),
            baseDir: project.dir,
          } as unknown as PrismaNextConfig,
          cwd: project.dir,
          projectDir: project.dir,
          statements,
          answerQuestions,
          client: { renderContractDts: renderContractDtsMock },
        },
        Date.now(),
      );
    }

    it('takes delete statements given to the control API as answers', async () => {
      const project = await losingProject();
      const answerQuestions = vi.fn(async () => []);

      const result = await planThroughControlApi(
        project,
        [
          { verb: 'delete', text: 'Legacy' },
          { verb: 'delete', text: 'audit_log' },
        ],
        answerQuestions,
      );

      expect(result.ok && result.value.appliedStatements).toMatchObject([
        { verb: 'delete', description: 'delete model "Legacy"' },
        { verb: 'delete', description: 'delete storage "audit_log"' },
      ]);
      expect(answerQuestions).toHaveBeenCalledWith([]);
    });

    it('refuses delete and allow statements given to the control API that answer no question', async () => {
      const project = await losingProject();

      const result = await planThroughControlApi(
        project,
        [
          { verb: 'delete', text: 'Legacy' },
          { verb: 'delete', text: 'audit_log' },
          { verb: 'delete', text: 'Nope' },
          { verb: 'allow', text: 'User' },
        ],
        async () => [],
      );

      expect(!result.ok && result.failure.toEnvelope()).toMatchObject({
        code: 'MIGRATION.STATEMENT_ANSWERS_NO_QUESTION',
        meta: {
          statements: [
            { verb: 'delete', text: 'Nope' },
            { verb: 'allow', text: 'User' },
          ],
        },
      });
      expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
    });

    it('refuses where nobody can answer, listing every operation with the flags that answer it', async () => {
      const project = await losingProject();

      const run = await harness(project, {
        script: {
          operations: [ADDITIVE_OP, DESTRUCTIVE_OP, DROP_AUDIT_OP],
          dataLoss: [LEGACY_LOSS, AUDIT_LOSS],
        },
      }).run(['migration', 'plan', '--json'], { cwd: project.dir });

      expect(run.exitCode).toBe(2);
      const envelope = envelopeOf(run) as {
        readonly error: { readonly code: string; readonly nextActions: readonly unknown[] };
      };
      expect(envelope.error.code).toBe('CLI.CONSENT_REQUIRED');
      const actions = JSON.stringify(envelope.error.nextActions);
      expect(actions).toContain('--delete Legacy');
      expect(actions).toContain("--rename 'Legacy:<new name>'");
      expect(actions).toContain('--delete audit_log');
      expect(actions).not.toContain('--rename audit_log');
      expect(JSON.stringify(envelope)).toContain(
        'Drop table \\"legacy\\" would lose the data of model \\"Legacy\\".',
      );
      expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
    });

    it('writes the plan once --delete names the subject, and reports the statement', async () => {
      const project = await losingProject();

      const run = await harness(project, { script: losingScript }).run(
        ['migration', 'plan', '--delete', 'Legacy', '--json'],
        { cwd: project.dir },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        appliedStatements: [
          {
            verb: 'delete',
            statement: {
              kind: 'delete',
              subject: { kind: 'model', namespaceId: 'app', model: 'Legacy' },
            },
            operationIndexes: [1],
            description: 'delete model "Legacy"',
          },
        ],
      });
      expect((await plannedDirs(project)).length).toBe(2);
    });

    it('lists the delete under Statements applied, and keeps the marker on the operation', async () => {
      const project = await losingProject();

      const run = await harness(project, { script: losingScript }).run(
        ['migration', 'plan', '--delete', 'Legacy'],
        { cwd: project.dir, isTty: { stdout: true } },
      );

      expect(run.presented?.presentation.human).toContainEqual({
        kind: 'tree',
        roots: [
          {
            label: 'Statements applied',
            children: [{ label: 'delete model "Legacy" (1 operation)' }],
          },
        ],
      });
      expect(JSON.stringify(run.presented?.presentation.human)).toContain(
        '{"label":"Drop table \\"legacy\\"","status":"warn"}',
      );
    });

    it('plans a --rename from the flag in the first plan, which then loses nothing', async () => {
      const project = await losingProject();
      const statementsReceived: unknown[][] = [];

      const run = await harness(project, {
        script: { ...losingScript, statementsResolveDataLoss: true, statementsReceived },
      }).run(['migration', 'plan', '--rename', 'Legacy:Archive', '--json'], { cwd: project.dir });

      expect(run.exitCode).toBe(0);
      expect(statementsReceived).toEqual([
        [
          {
            kind: 'rename',
            entity: 'model',
            from: { namespaceId: 'app', model: 'Legacy' },
            to: { namespaceId: 'app', model: 'Archive' },
          },
        ],
      ]);
    });

    it('plans again with a rename typed at the prompt, and writes the plan', async () => {
      const project = await losingProject();
      const statementsReceived: unknown[][] = [];

      const run = await harness(project, {
        script: { ...losingScript, statementsResolveDataLoss: true, statementsReceived },
      }).run(['migration', 'plan', '--json'], {
        cwd: project.dir,
        isTty: { stdin: true },
        answers: ['rename Legacy:Archive'],
      });

      expect(run.exitCode).toBe(0);
      expect(statementsReceived.map((statements) => statements.length)).toEqual([0, 1]);
      expect(run.presented?.data).toMatchObject({
        appliedStatements: [{ verb: 'rename', description: 'rename model "Legacy" to "Archive"' }],
      });
      expect((await plannedDirs(project)).length).toBe(2);
    });

    it('fails when a typed rename does not remove the loss it answered', async () => {
      const project = await losingProject();

      const run = await harness(project, { script: losingScript }).run(
        ['migration', 'plan', '--json'],
        {
          cwd: project.dir,
          isTty: { stdin: true },
          answers: ['rename Legacy:Archive'],
        },
      );

      expect(run.exitCode).not.toBe(0);
      expect(envelopeOf(run)).toMatchObject({
        error: {
          code: 'MIGRATION.STATEMENT_DID_NOT_RESOLVE_LOSS',
          meta: { statement: 'Legacy:Archive', subject: 'Legacy' },
        },
      });
      expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
    });

    it('writes the plan when delete is typed at the prompt', async () => {
      const project = await losingProject();

      const run = await harness(project, { script: losingScript }).run(
        ['migration', 'plan', '--json'],
        {
          cwd: project.dir,
          isTty: { stdin: true },
          answers: ['delete'],
        },
      );

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        appliedStatements: [{ verb: 'delete', description: 'delete model "Legacy"' }],
      });
    });

    it('fails on a typed answer the question rejects, with scripted input', async () => {
      const project = await losingProject();

      const run = await harness(project, { script: losingScript }).run(
        ['migration', 'plan', '--json'],
        {
          cwd: project.dir,
          isTty: { stdin: true },
          answers: ['delete Nope'],
        },
      );

      expect(envelopeOf(run)).toMatchObject({ error: { code: 'CLI.PROMPT_INVALID' } });
      expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
    });

    it('refuses a --delete nothing asked for before writing anything', async () => {
      const project = await losingProject();

      const run = await harness(project).run(['migration', 'plan', '--delete', 'Nope', '--json'], {
        cwd: project.dir,
      });

      expect(envelopeOf(run)).toMatchObject({ error: { code: 'CLI.CONSENT_UNUSED' } });
      expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
    });

    it('does not take --yes as an answer', async () => {
      const project = await losingProject();

      const run = await harness(project, { script: losingScript }).run(
        ['migration', 'plan', '--yes', '--json'],
        { cwd: project.dir, isTty: { stdin: true } },
      );

      expect(envelopeOf(run)).toMatchObject({ error: { code: 'CLI.CONSENT_REQUIRED' } });
      expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
    });

    it('does not take --confirm as consent', async () => {
      const project = await losingProject();

      const run = await harness(project, { script: losingScript }).run(
        ['migration', 'plan', '--confirm', basename(project.dir), '--json'],
        { cwd: project.dir },
      );

      expect(envelopeOf(run)).toMatchObject({ error: { code: 'CLI.CONSENT_REQUIRED' } });
      expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
    });

    it('asks before writing either package of an auto-baseline whose delta loses data', async () => {
      const project = await losingBaselineProject();
      const script: FakePlannerScript = {
        operationsByPlan: [[ADDITIVE_OP], [ADDITIVE_OP, DESTRUCTIVE_OP]],
        dataLossByPlan: [[], [LEGACY_LOSS]],
      };

      const refused = await harness(project, { script }).run(['migration', 'plan', '--json'], {
        cwd: project.dir,
      });
      expect(envelopeOf(refused)).toMatchObject({ error: { code: 'CLI.CONSENT_REQUIRED' } });
      expect(await plannedDirs(project)).toEqual([]);

      const answered = await harness(project, { script }).run(
        ['migration', 'plan', '--delete', 'Legacy', '--json'],
        { cwd: project.dir },
      );
      expect(answered.exitCode).toBe(0);
      expect((await plannedDirs(project)).length).toBe(2);
    });

    it('writes a placeholder plan once its loss is answered, positioning the loss among the listed operations', async () => {
      const project = await losingBaselineProject();

      const run = await harness(project, {
        script: {
          operations: [ADDITIVE_OP, DESTRUCTIVE_OP],
          throwOnOperations: errorUnfilledPlaceholder('backfill'),
          placeholderAt: 1,
          dataLoss: [{ ...LEGACY_LOSS, operationIndex: 2 }],
        },
      }).run(['migration', 'plan', '--delete', 'Legacy', '--json'], { cwd: project.dir });

      expect(run.exitCode).toBe(0);
      const data = run.presented?.data as {
        readonly pendingPlaceholders: boolean;
        readonly operations: readonly { readonly id: string }[];
        readonly appliedStatements: readonly { readonly operationIndexes: readonly number[] }[];
      };
      expect(data.pendingPlaceholders).toBe(true);
      expect(
        data.appliedStatements.map(({ operationIndexes }) =>
          operationIndexes.map((index) => data.operations[index]?.id),
        ),
      ).toEqual([[DESTRUCTIVE_OP.id]]);
      expect((await plannedDirs(project)).length).toBe(2);
    });

    it('still asks about a loss when the operations accessor throws on a placeholder', async () => {
      const project = await losingProject();
      const script: FakePlannerScript = {
        operations: [ADDITIVE_OP, DESTRUCTIVE_OP],
        operationsAccessorThrows: errorUnfilledPlaceholder('backfill'),
        dataLoss: [LEGACY_LOSS],
      };

      const refused = await harness(project, { script }).run(['migration', 'plan', '--json'], {
        cwd: project.dir,
      });
      expect(envelopeOf(refused)).toMatchObject({ error: { code: 'CLI.CONSENT_REQUIRED' } });

      const answered = await harness(project, { script }).run(
        ['migration', 'plan', '--delete', 'Legacy', '--json'],
        { cwd: project.dir },
      );
      expect(answered.exitCode).toBe(0);
      expect(answered.presented?.data).toMatchObject({ pendingPlaceholders: true });
    });

    it('asks a question a re-plan brings up in a second batch', async () => {
      const project = await losingProject();

      const run = await harness(project, {
        script: {
          operations: [ADDITIVE_OP, DESTRUCTIVE_OP, DROP_AUDIT_OP],
          dataLossByPlan: [[LEGACY_LOSS], [AUDIT_LOSS]],
        },
      }).run(['migration', 'plan', '--json'], {
        cwd: project.dir,
        isTty: { stdin: true },
        answers: ['rename Legacy:Archive', 'delete'],
      });

      expect(run.exitCode).toBe(0);
      expect(run.presented?.data).toMatchObject({
        appliedStatements: [
          { verb: 'rename', description: 'rename model "Legacy" to "Archive"' },
          { verb: 'delete', description: 'delete storage "audit_log"', operationIndexes: [2] },
        ],
      });
    });

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
      const actions = JSON.stringify(
        (envelopeOf(refused) as { readonly error: { readonly nextActions: unknown } }).error
          .nextActions,
      );
      expect(actions).toContain('--delete User.nickname');
      expect(actions).toContain("--rename 'User.nickname:User.<new name>'");

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

  it('reports baseline ops beside the delta and renders one tree root per package', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedContractSnapshot({ migrationsDir: project.migrationsDir, storageHash: HASH_FROM });
    await seedDbRef({ appMigrationsDir: project.appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project, {
      script: { operations: [ADDITIVE_OP, DESTRUCTIVE_OP] },
    }).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    const data = run.presented?.data as {
      baselineDir: string;
      dir: string;
      operations: readonly { id: string; operationClass: string }[];
      baselineOperations?: readonly { id: string; operationClass: string }[];
    };
    expect(data.operations).toHaveLength(2);
    expect(data.baselineOperations).toHaveLength(2);
    const tree = (run.presented?.presentation.human ?? []).find(
      (block) => block.kind === 'tree',
    ) as { roots: readonly { label: string; children: readonly unknown[] }[] };
    expect(tree.roots.map((root) => root.label)).toEqual([data.baselineDir, data.dir]);
    expect(tree.roots.map((root) => root.children.length)).toEqual([2, 2]);
    expect(run.presented?.presentation.human).toContainEqual({
      kind: 'summary',
      status: 'warn',
      text: 'This migration contains destructive operations that may cause data loss.',
    });
  });
  it('renders extension-space dirs under the configured migrations directory', async () => {
    const EXT_HASH = `f00d${'3'.repeat(60)}`;
    const extMetadataBase = {
      from: null,
      to: EXT_HASH,
      providedInvariants: [],
      createdAt: '2026-01-01T00:00:00.000Z',
    };
    const extMetadata = {
      ...extMetadataBase,
      migrationHash: computeMigrationHash(extMetadataBase, []),
    };
    const project = await createOfflineProject({ storageHash: HASH_TO });
    const migrationsDir = join(project.dir, 'db-migrations');
    const appMigrationsDir = join(migrationsDir, 'app');
    await seedMigrationPackage({
      appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });
    await seedContractSnapshot({ migrationsDir, storageHash: HASH_FROM });
    await seedDbRef({ appMigrationsDir, storageHash: HASH_FROM });

    const run = await harness(project, {
      overrides: {
        migrations: { dir: 'db-migrations' },
        extensions: [
          {
            kind: 'extension',
            id: 'cipherstash',
            familyId: 'sql',
            targetId: 'postgres',
            version: '1.0.0',
            create: () => ({}),
            contractSpace: {
              contractJson: contractJson(EXT_HASH),
              headRef: { hash: EXT_HASH, invariants: [] },
              migrations: [{ dirName: '0001_seed', metadata: extMetadata, ops: [] }],
            },
          },
        ],
      },
    }).run(['migration', 'plan', '--name', 'add-users'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      emittedExtensionDirs: [{ spaceId: 'cipherstash', dirName: '0001_seed' }],
    });
    const extensionDir = join('db-migrations', 'cipherstash', '0001_seed');
    const fieldRows = (run.presented?.presentation.human ?? []).flatMap((block) =>
      block.kind === 'fields' ? block.rows : [],
    );
    expect(fieldRows).toContainEqual({ label: 'space cipherstash', value: extensionDir });
    expect(run.presented?.presentation.next?.at(0)).toMatchObject({
      kind: 'edit-file',
      label: expect.stringContaining(extensionDir),
    });
  });

  it('emits the total time only as a verbose message', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan'], { cwd: project.dir });

    expect(run.events).toContainEqual({
      kind: 'message',
      severity: 'verbose',
      text: expect.stringMatching(/^Total time: \d+ms$/),
    });
  });

  it('writes nothing to stdout in human mode', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.stdout).toBe('');
    expect(run.presented?.presentation.stdout).toEqual([]);
  });

  it('errors when the contract has not been emitted', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project, {
      overrides: {
        contract: {
          source: { format: 'typescript', inputs: [], load: async () => ({}) },
          output: join(project.dir, 'output', 'missing.json'),
        },
      },
    }).run(['migration', 'plan', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CLI.FILE_NOT_FOUND' } },
    });
  });

  it('errors when the planner reports a conflict', async () => {
    const project = await plannableProject();

    const run = await harness(project, {
      script: { conflicts: [{ kind: 'unsupportedChange', summary: 'cannot narrow this column' }] },
    }).run(['migration', 'plan', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'MIGRATION.PLANNING_FAILED' } },
    });
  });

  it('reports a contract default the planner refuses as CONTRACT.DEFAULT_INVALID', async () => {
    const project = await plannableProject();
    const refusal =
      'Column "at": The contract holds this default in a form its data type does not store: pg/timestamptz needs a UTC offset, but "2024-01-01 00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z". Re-emit the contract, then try again.';

    const run = await harness(project, {
      script: {
        throwOnPlan: structuredError('CONTRACT.DEFAULT_INVALID', refusal, {
          meta: { reason: 'default-not-canonical', column: 'at' },
        }),
      },
    }).run(['migration', 'plan', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: {
        ok: false,
        error: {
          code: 'CONTRACT.DEFAULT_INVALID',
          summary: refusal,
          meta: { reason: 'default-not-canonical', column: 'at' },
        },
      },
    });
  });

  it('errors when migrations exist but no db ref and no --from names an origin', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });

    const run = await harness(project).run(['migration', 'plan', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
    expect(envelope).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.PLAN_ORIGIN_UNKNOWN' },
    });
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
  });

  it('plans a greenfield migration over existing history with --from @empty', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });
    await seedMigrationPackage({
      appMigrationsDir: project.appMigrationsDir,
      dirName: '20260101T0000_initial',
      from: null,
      to: HASH_FROM,
    });

    const run = await harness(project).run(
      ['migration', 'plan', '--from', '@empty', '--name', 'rebuild', '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ ok: true, from: null, to: HASH_TO });
  });

  it('errors when --from names a hash outside the graph', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(
      ['migration', 'plan', '--from', `dead${'2'.repeat(60)}`, '--json'],
      { cwd: project.dir },
    );

    expect(run.exitCode).toBe(2);
    const terminal = run.json.at(-1);
    const envelope =
      terminal !== undefined && terminal.kind === 'result' ? terminal.envelope : undefined;
    expect(envelope).toMatchObject({ ok: false });
    expect(envelope?.nextActions.length).toBeGreaterThan(0);
    expect(envelope).not.toHaveProperty('fix');
  });
});

describe('migration plan greenfield notice', () => {
  const NOTICE =
    'No db ref set — planning from an empty database. Run db init, db update, or db sign if a database already exists.';

  it('explains the empty origin when no db ref exists and the graph is empty', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'plan', '--name', 'init'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ from: null, to: HASH_TO, fromDefaulted: true });
    expect(run.presented?.presentation.human.at(2)).toEqual({
      kind: 'summary',
      status: 'info',
      tone: 'muted',
      text: NOTICE,
    });
  });

  it('stays silent when --from @empty names the origin', async () => {
    const project = await createOfflineProject({ storageHash: HASH_TO });

    const run = await harness(project).run(['migration', 'plan', '--from', '@empty'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({ from: null, to: HASH_TO });
    expect(run.presented?.data).not.toHaveProperty('fromDefaulted');
    expect(run.presented?.presentation.human).not.toContainEqual(
      expect.objectContaining({ text: NOTICE }),
    );
  });

  it('stays silent when a db ref sets the origin', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan'], {
      cwd: project.dir,
      isTty: { stdout: true },
    });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).not.toHaveProperty('fromDefaulted');
    expect(run.presented?.presentation.human).not.toContainEqual(
      expect.objectContaining({ text: NOTICE }),
    );
  });
});

describe('migration plan destination snapshot', () => {
  it('writes the destination snapshot with declarations rendered from the emitted contract', async () => {
    const project = await plannableProject();

    const run = await harness(project).run(['migration', 'plan', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(0);
    expect(renderContractDtsMock).toHaveBeenCalledWith({
      contract: contractJson(HASH_TO),
      resolveImportSpecifier: expect.any(Function),
    });
    const storeDir = contractSnapshotDir(project.migrationsDir, HASH_TO);
    expect(JSON.parse(await readFile(join(storeDir, 'contract.json'), 'utf-8'))).toEqual(
      contractJson(HASH_TO),
    );
    expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(RENDERED_CONTRACT_DTS);
  });

  it('refuses before writing anything when the declarations cannot be rendered', async () => {
    const project = await plannableProject();
    renderContractDtsMock.mockResolvedValue(
      notOk({
        code: 'RENDER_FAILED',
        summary: 'Failed to render contract types',
        why: 'relation author must declare nullability',
      }),
    );

    const run = await harness(project).run(['migration', 'plan', '--json'], { cwd: project.dir });

    expect(run.exitCode).toBe(2);
    expect(run.json.at(-1)).toMatchObject({
      kind: 'result',
      envelope: { ok: false, error: { code: 'CONTRACT.TYPES_RENDER_FAILED' } },
    });
    expect(await plannedDirs(project)).toEqual(['20260101T0000_initial']);
    expect(existsSync(contractSnapshotDir(project.migrationsDir, HASH_TO))).toBe(false);
  });
});
