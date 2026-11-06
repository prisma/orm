import { existsSync, rmSync, writeFileSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import {
  migrationRunnerFailure,
  type SchemaDiffIssue,
  schemaCheckWhy,
} from '@internal/framework-components/control';
import { contractSnapshotDir } from '@internal/migration-tools/contract-snapshot-store';
import { notOk, ok } from '@internal/utils/result';
import { docsUrlFor, structuredError } from '@internal/utils/structured-error';
import type { EngineEvent, StreamEvent } from '@prisma/cli-engine';
import { join } from 'pathe';
import stripAnsi from 'strip-ansi';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import { runnerFailureFacts } from '../../src/control-api/operations/run-migration';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { errorMigrationPlanningFailed } from '../../src/utils/cli-errors';
import { dbUpdateRunnerFailureError } from '../../src/utils/db-update-failure';
import { stdoutErrorMeta, stdoutFrames } from '../helpers/json-frames';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const REFUSAL =
  'Column "at": The contract holds this default in a form its data type does not store: pg/timestamptz needs a UTC offset, but "2024-01-01 00:00:00" has none. Add Z for UTC or an offset such as +02:00, as in "2024-01-01T12:34:56Z". Re-emit the contract, then try again.';

function refusedDefault(): Error {
  return structuredError('CONTRACT.DEFAULT_INVALID', REFUSAL, {
    meta: { reason: 'default-not-canonical', column: 'at' },
  });
}

const MISSING_COLUMN: SchemaDiffIssue = {
  path: ['public', 'event', 'id'],
  expected: { id: 'id', nodeKind: 'sql-column', isEqualTo: () => false, children: () => [] },
};

const WARNING = { kind: 'suppressed', summary: 'control policy suppressed: table "auth.x"' };

const mocks = {
  connect: vi.fn(),
  dbUpdate: vi.fn(),
  renderContractDts: vi.fn(),
  close: vi.fn(),
};
const RENDERED_CONTRACT_DTS = '// rendered\nexport type Contract = { rendered: true };\n';

/** The command tree mounted over a control-client double instead of the real client. */
const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      dbUpdate: mocks.dbUpdate,
      renderContractDts: mocks.renderContractDts,
      close: mocks.close,
    }) as unknown as ControlClient,
);
const groups = BIN_GROUPS;

afterAll(() => {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
});

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

const DEST_HASH = 'd'.repeat(64);
const MARKER_HASH = 'a'.repeat(64);
const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';

let projectDir: string;
const projectDirs: string[] = [];

beforeEach(() => {
  projectDir = createTestProjectDir('orm-db-update');
  projectDirs.push(projectDir);
  writeProjectManifest(projectDir);
  writeFileSync(
    join(projectDir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: MARKER_HASH } }),
  );
  writeFileSync(join(projectDir, 'contract.d.ts'), 'export type Contract = never;\n');
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.dbUpdate.mockReset().mockResolvedValue(ok(applySuccess()));
  mocks.renderContractDts.mockReset().mockResolvedValue(ok({ contractDts: RENDERED_CONTRACT_DTS }));
});

function ormConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    family: {
      kind: 'family',
      id: 'sql',
      familyId: 'sql',
      version: '1.0.0',
      emission: {},
      create: () => ({}),
    },
    target: { ...DESCRIPTOR, kind: 'target', id: 'postgres', migrations: {} },
    adapter: { ...DESCRIPTOR, kind: 'adapter', id: 'pg' },
    driver: { ...DESCRIPTOR, kind: 'driver', id: 'pg-driver' },
    db: { connection: CONNECTION },
    contract: {
      source: { format: 'typescript', inputs: [], load: async () => ({}) },
      output: join(projectDir, 'contract.json'),
    },
    ...overrides,
  };
}

function applySuccess(): Record<string, unknown> {
  return {
    mode: 'apply',
    appliedStatements: [],
    dataLoss: [],
    accessChanges: [],
    destination: { storageHash: DEST_HASH },
    plan: {
      operations: [
        { id: 'op-1', label: 'add column user.nickname', operationClass: 'additive' },
        { id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' },
      ],
    },
    execution: { operationsPlanned: 2, operationsExecuted: 2 },
    marker: { storageHash: MARKER_HASH },
    perSpace: [
      {
        spaceId: 'app',
        kind: 'app',
        operations: [
          { id: 'op-1', label: 'add column user.nickname', operationClass: 'additive' },
          { id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' },
        ],
        marker: { storageHash: MARKER_HASH },
      },
    ],
    summary: 'Database updated',
  };
}

function planSuccess(): Record<string, unknown> {
  return {
    mode: 'plan',
    appliedStatements: [],
    dataLoss: [],
    accessChanges: [],
    destination: { storageHash: DEST_HASH },
    plan: {
      operations: [{ id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' }],
      preview: { statements: [{ language: 'sql', text: 'DROP TABLE "legacy"' }] },
    },
    perSpace: [
      {
        spaceId: 'app',
        kind: 'app',
        operations: [{ id: 'op-2', label: 'drop relation legacy', operationClass: 'destructive' }],
      },
    ],
    summary: 'Planned 1 operation',
  };
}

function harness(config: Record<string, unknown> = ormConfig()) {
  return createOrmTestCli({ commands, groups, orm: config });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

function stepEvents(events: readonly EngineEvent[]): readonly EngineEvent[] {
  return events.filter((event) => event.kind === 'step-started' || event.kind === 'step-finished');
}

const PROFILE_TO_USER = {
  statement: {
    kind: 'rename',
    entity: 'model',
    from: { namespaceId: 'app', model: 'Profile' },
    to: { namespaceId: 'app', model: 'User' },
  },
  operationIndexes: [0, 1],
  description: 'rename model "Profile" to "User"',
};

describe('db update --rename', () => {
  it('hands every --rename to the control API in the order given', async () => {
    await harness().run(['db', 'update', '--rename', 'Profile:User', '--rename', 'User.a:User.b'], {
      cwd: projectDir,
    });
    expect(mocks.dbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        statements: [
          { verb: 'rename', text: 'Profile:User' },
          { verb: 'rename', text: 'User.a:User.b' },
        ],
      }),
    );
  });

  it('hands an empty list when no --rename is given', async () => {
    await harness().run(['db', 'update'], { cwd: projectDir });
    expect(mocks.dbUpdate).toHaveBeenCalledWith(expect.objectContaining({ statements: [] }));
  });

  it('lists the applied statements after the operations, and in the JSON document', async () => {
    mocks.dbUpdate.mockResolvedValue(
      ok({ ...applySuccess(), appliedStatements: [PROFILE_TO_USER] }),
    );
    const run = await harness().run(['db', 'update', '--rename', 'Profile:User'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const human = run.presented?.presentation.human ?? [];
    expect(human).toContainEqual({
      kind: 'tree',
      roots: [
        {
          label: 'Statements applied',
          children: [{ label: 'rename model "Profile" to "User" (2 operations)' }],
        },
      ],
    });
    expect(run.presented?.data).toMatchObject({ appliedStatements: [PROFILE_TO_USER] });
  });

  it('says which field gets a temporary value in existing rows, and that migration plan --backfill chooses it', async () => {
    const temporaryValues = [{ field: 'User.email', value: "''" }];
    mocks.dbUpdate
      .mockResolvedValueOnce(ok({ ...planSuccess(), temporaryValues }))
      .mockResolvedValueOnce(ok({ ...applySuccess(), temporaryValues }));
    const dryRun = await harness().run(['db', 'update', '--dry-run'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const applied = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    expect(dryRun.presented?.presentation.human).toContainEqual({
      kind: 'summary',
      status: 'warn',
      text: `Existing rows would get '' in field "User.email". To choose the value, plan a migration with prisma-test migration plan --backfill User.email instead.`,
    });
    expect(applied.presented?.presentation.human).toContainEqual({
      kind: 'summary',
      status: 'warn',
      text: `Existing rows got '' in field "User.email". To choose the value, plan a migration with prisma-test migration plan --backfill User.email instead.`,
    });
    expect(applied.presented?.data).toMatchObject({ temporaryValues });
  });

  it('starts the migration plan it suggests for a temporary value from the contract the database is at', async () => {
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...planSuccess(),
        temporaryValues: [{ field: 'User.email', value: "''" }],
        databaseStorageHash: MARKER_HASH,
      }),
    );
    const run = await harness().run(['db', 'update', '--dry-run'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human).toContainEqual({
      kind: 'summary',
      status: 'warn',
      text: `Existing rows would get '' in field "User.email". To choose the value, plan a migration with prisma-test migration plan --from ${MARKER_HASH} --backfill User.email instead.`,
    });
    expect(run.presented?.data).not.toHaveProperty('databaseStorageHash');
  });

  it('lists what an apply would ask about on a dry run, in its output and its JSON', async () => {
    const legacy = { kind: 'model', namespaceId: 'app', model: 'Legacy' } as const;
    const age = { kind: 'field', namespaceId: 'app', model: 'User', field: 'age' } as const;
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...planSuccess(),
        dataLoss: [
          { operationIndex: 0, subject: legacy, text: 'Legacy', loss: 'drop' },
          { operationIndex: 0, subject: age, text: 'User.age', loss: 'typeChange' },
        ],
      }),
    );
    const human = await harness().run(['db', 'update', '--dry-run'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const json = await harness().run(['db', 'update', '--dry-run', '--json'], { cwd: projectDir });

    expect(human.presented?.presentation.human).toContainEqual({
      kind: 'tree',
      roots: [
        {
          label: 'An apply asks about',
          children: [
            { label: 'drop relation legacy: --delete Legacy' },
            { label: 'drop relation legacy: --delete User.age' },
          ],
        },
      ],
    });
    expect(json.presented?.data).toMatchObject({
      dataLoss: [
        { operationIndex: 0, subject: legacy, text: 'Legacy', loss: 'drop', answered: false },
        {
          operationIndex: 0,
          subject: age,
          text: 'User.age',
          loss: 'typeChange',
          answered: false,
        },
      ],
      accessChanges: [],
    });
  });

  it('lists one line per answer on a dry run, naming every operation it answers', async () => {
    const archived = { kind: 'enumValue', namespaceId: 'app', enum: 'Status', member: 'ARCHIVED' };
    const operations = [
      {
        id: 'op-1',
        label: 'Remove value "archived" from column "status" of "task"',
        operationClass: 'destructive',
      },
      {
        id: 'op-2',
        label: 'Remove value "archived" from column "tags" of "task"',
        operationClass: 'destructive',
      },
    ];
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...planSuccess(),
        plan: { operations },
        dataLoss: [
          { operationIndex: 0, subject: archived, text: 'Status.ARCHIVED', loss: 'drop' },
          { operationIndex: 1, subject: archived, text: 'Status.ARCHIVED', loss: 'drop' },
        ],
      }),
    );
    const human = await harness().run(['db', 'update', '--dry-run'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    expect(human.presented?.presentation.human).toContainEqual({
      kind: 'tree',
      roots: [
        {
          label: 'An apply asks about',
          children: [
            {
              label:
                'Remove value "archived" from column "status" of "task" and remove value "archived" from column "tags" of "task": --delete Status.ARCHIVED',
            },
          ],
        },
      ],
    });
  });

  it('lists the access an apply would widen on a dry run, marked answered by an --allow', async () => {
    const user = { kind: 'model', namespaceId: 'app', model: 'User' } as const;
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...planSuccess(),
        accessChanges: [{ operationIndex: 0, subject: user, text: 'User' }],
      }),
    );

    const run = await harness().run(['db', 'update', '--dry-run', '--allow', 'User', '--json'], {
      cwd: projectDir,
    });

    expect(run.presented?.data).toMatchObject({
      accessChanges: [{ operationIndex: 0, subject: user, text: 'User', answered: true }],
    });
  });

  it('marks the questions the flags of a dry run answer, and repeats the flags in the apply it suggests', async () => {
    const legacy = { kind: 'model', namespaceId: 'app', model: 'Legacy' } as const;
    const audit = { kind: 'storage', name: "audit log's" } as const;
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...planSuccess(),
        dataLoss: [
          { operationIndex: 0, subject: legacy, text: 'Legacy' },
          { operationIndex: 0, subject: audit, text: "audit log's" },
        ],
      }),
    );
    const run = await harness().run(
      ['db', 'update', '--dry-run', '--rename', 'Profile:User', '--delete', 'Legacy'],
      { cwd: projectDir, isTty: { stdout: true } },
    );

    expect(run.presented?.presentation.human).toContainEqual({
      kind: 'tree',
      roots: [
        {
          label: 'An apply asks about',
          children: [
            { label: 'drop relation legacy: --delete Legacy (answered)' },
            { label: "drop relation legacy: --delete 'audit log'\\''s'" },
          ],
        },
      ],
    });
    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Apply the planned operations',
        command: 'prisma-test db update --rename Profile:User --delete Legacy',
      },
    ]);
  });

  it('marks every question about a model of a namespace a dry run --delete names as answered', async () => {
    const invoice = { kind: 'model', namespaceId: 'billing', model: 'Invoice' } as const;
    const receipt = { kind: 'model', namespaceId: 'billing', model: 'Receipt' } as const;
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...planSuccess(),
        dataLoss: [
          {
            operationIndex: 0,
            subject: invoice,
            text: 'billing.Invoice',
            removedNamespace: 'billing',
          },
          {
            operationIndex: 0,
            subject: receipt,
            text: 'billing.Receipt',
            removedNamespace: 'billing',
          },
        ],
        namespaces: { removed: ['billing'], added: [] },
      }),
    );
    const args = ['db', 'update', '--dry-run', '--delete', 'billing'];

    const human = await harness().run(args, { cwd: projectDir, isTty: { stdout: true } });
    const json = await harness().run([...args, '--json'], { cwd: projectDir });

    expect(human.presented?.presentation.human).toContainEqual({
      kind: 'tree',
      roots: [
        {
          label: 'An apply asks about',
          children: [
            { label: 'drop relation legacy: --delete billing.Invoice (answered)' },
            { label: 'drop relation legacy: --delete billing.Receipt (answered)' },
            { label: 'every question about namespace "billing": --delete billing (answered)' },
          ],
        },
      ],
    });
    expect(json.presented?.data).toMatchObject({
      dataLoss: [
        {
          answered: true,
          answeredBy: { verb: 'delete', text: 'billing' },
          removedNamespace: 'billing',
        },
        {
          answered: true,
          answeredBy: { verb: 'delete', text: 'billing' },
          removedNamespace: 'billing',
        },
      ],
      removedNamespaces: [
        { namespaceId: 'billing', answeredBy: { verb: 'delete', text: 'billing' } },
      ],
      addedNamespaces: [],
    });
  });

  it('lists the namespace answers of a removed namespace, with the rename to a namespace the destination adds', async () => {
    const invoice = { kind: 'model', namespaceId: 'billing', model: 'Invoice' } as const;
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...planSuccess(),
        dataLoss: [
          {
            operationIndex: 0,
            subject: invoice,
            text: 'billing.Invoice',
            removedNamespace: 'billing',
          },
        ],
        namespaces: { removed: ['billing'], added: ['finance'] },
      }),
    );

    const human = await harness().run(['db', 'update', '--dry-run'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const json = await harness().run(['db', 'update', '--dry-run', '--json'], { cwd: projectDir });

    expect(json.presented?.data).toMatchObject({
      removedNamespaces: [{ namespaceId: 'billing' }],
      addedNamespaces: ['finance'],
    });
    expect(json.presented?.data).toMatchObject({
      dataLoss: [expect.not.objectContaining({ addedNamespaces: expect.anything() })],
    });

    expect(human.presented?.presentation.human).toContainEqual({
      kind: 'tree',
      roots: [
        {
          label: 'An apply asks about',
          children: [
            { label: 'drop relation legacy: --delete billing.Invoice' },
            {
              label:
                'every question about namespace "billing": --delete billing, or --rename billing:finance if it was renamed',
            },
          ],
        },
      ],
    });
  });

  it('suggests the apply with the database as a placeholder and the ref it advances', async () => {
    mocks.dbUpdate.mockResolvedValue(ok(planSuccess()));
    const run = await harness().run(
      [
        'db',
        'update',
        '--dry-run',
        '--db',
        'postgres://user:secret@localhost/appdb',
        '--advance-ref',
        'qa',
      ],
      { cwd: projectDir, isTty: { stdout: true } },
    );

    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Apply the planned operations',
        command: 'prisma-test db update --advance-ref qa --db <url>',
      },
    ]);
  });

  it('repeats --config and --db in every command a dry run prints, as a shell reads them', async () => {
    mocks.dbUpdate.mockResolvedValue(
      ok({ ...planSuccess(), temporaryValues: [{ field: 'User.email', value: "''" }] }),
    );
    const run = await harness().run(
      [
        'db',
        'update',
        '--dry-run',
        '--db',
        CONNECTION,
        '--advance-ref',
        'qa',
        '--config',
        'my app/prisma.config.ts',
      ],
      { cwd: projectDir, isTty: { stdout: true } },
    );

    expect({
      next: run.presented?.presentation.next,
      temporaryValue: run.presented?.presentation.human.find(
        (block) =>
          block.kind === 'summary' &&
          typeof block.text === 'string' &&
          block.text.startsWith('Existing rows'),
      ),
    }).toEqual({
      next: [
        {
          kind: 'run-command',
          label: 'Apply the planned operations',
          command:
            "prisma-test db update --advance-ref qa --config 'my app/prisma.config.ts' --db <url>",
        },
      ],
      temporaryValue: {
        kind: 'summary',
        status: 'warn',
        text: `Existing rows would get '' in field "User.email". To choose the value, plan a migration with prisma-test migration plan --backfill User.email --config 'my app/prisma.config.ts' instead.`,
      },
    });
  });

  it('repeats --config and --db in the command an apply says to run next', async () => {
    const run = await harness().run(
      ['db', 'update', '--db', CONNECTION, '--config', 'app/prisma.config.ts'],
      { cwd: projectDir, isTty: { stdout: true } },
    );

    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Confirm the space is up to date',
        command: 'prisma-test migration status --config app/prisma.config.ts --db <url>',
      },
    ]);
  });

  it('lists the applied statements on a dry run', async () => {
    mocks.dbUpdate.mockResolvedValue(
      ok({ ...planSuccess(), appliedStatements: [{ ...PROFILE_TO_USER, operationIndexes: [] }] }),
    );
    const run = await harness().run(['db', 'update', '--dry-run', '--rename', 'Profile:User'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    expect(run.presented?.presentation.human).toContainEqual({
      kind: 'tree',
      roots: [
        {
          label: 'Statements applied',
          children: [{ label: 'rename model "Profile" to "User" (no operations)' }],
        },
      ],
    });
  });
});

describe('db update', () => {
  it('settles as a completed envelope carrying the migration document', async () => {
    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(0);
    expect(run.presented?.data).toMatchObject({
      ok: true,
      mode: 'apply',
      plan: { targetId: 'postgres', destination: { storageHash: DEST_HASH } },
      execution: { operationsPlanned: 2, operationsExecuted: 2 },
      marker: { storageHash: MARKER_HASH },
      advancedRef: { name: 'db', hash: MARKER_HASH },
      plannedAdvanceRef: null,
      summary: 'Database updated',
    });
  });

  it('reports the control API`s spans as step events rather than printing them', async () => {
    mocks.dbUpdate.mockImplementation(
      (options: { onProgress?: (event: Record<string, unknown>) => void }) => {
        options.onProgress?.({
          action: 'dbUpdate',
          kind: 'spanStart',
          spanId: 'plan',
          label: 'Planning operations',
        });
        options.onProgress?.({
          action: 'dbUpdate',
          kind: 'spanEnd',
          spanId: 'plan',
          outcome: 'ok',
        });
        return Promise.resolve(ok(applySuccess()));
      },
    );

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(stepEvents(run.events)).toEqual([
      { kind: 'step-started', step: 'Planning operations', id: 'plan' },
      { kind: 'step-finished', step: 'Planning operations', id: 'plan', outcome: 'ok' },
    ]);
  });

  it('heads the run with the contract and the masked database', async () => {
    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.human[0]).toEqual({
      kind: 'fields',
      rail: true,
      rows: [
        { label: 'contract', value: 'contract.json' },
        { label: 'database', value: 'postgres://****:****@localhost:5432/appdb' },
      ],
    });
  });

  it('marks the destructive operation in the tree and warns about data loss', async () => {
    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const blocks = run.presented?.presentation.human ?? [];

    expect(blocks[1]).toEqual({
      kind: 'summary',
      status: 'ok',
      text: 'Applied 2 operation(s) across 1 contract space',
    });
    expect(blocks[2]).toEqual({
      kind: 'tree',
      roots: [
        {
          label: [{ text: 'App space', tone: 'identifier' }],
          children: [
            { label: 'add column user.nickname' },
            { label: 'drop relation legacy', status: 'warn' },
            {
              label: [
                { text: 'marker ', tone: 'muted' },
                { text: MARKER_HASH, tone: 'identifier' },
              ],
            },
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

  it('renders the applied tree with the engine`s own connectors', async () => {
    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true, stderr: true },
    });
    const rendered = stripAnsi(run.stderr);

    expect(rendered).toContain('App space');
    expect(rendered).toMatch(/├─ add column user\.nickname/);
    expect(rendered).toMatch(new RegExp(`└─ .*marker ${MARKER_HASH}`));
    expect(run.stdout).toBe('');
  });

  it('shows the planner`s warnings without failing the run', async () => {
    mocks.dbUpdate.mockImplementation(async (options: Parameters<ControlClient['dbUpdate']>[0]) => {
      options.onPlannerWarnings?.([
        { kind: 'suppressed', summary: 'Column user.legacy is dropped without a backfill' },
      ]);
      return ok(applySuccess());
    });

    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    const blocks = run.presented?.presentation.human ?? [];

    expect(run.exitCode).toBe(0);
    expect(blocks[2]).toEqual({ kind: 'summary', status: 'warn', text: 'Planner warnings' });
    expect(blocks[3]).toEqual({
      kind: 'list',
      items: ['Column user.legacy is dropped without a backfill'],
    });
  });

  it('names the follow-up as a typed action instead of trailing prose', async () => {
    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });

    expect(run.presented?.presentation.next).toEqual([
      {
        kind: 'run-command',
        label: 'Confirm the space is up to date',
        command: 'prisma-test migration status',
      },
    ]);
  });

  describe('--dry-run', () => {
    beforeEach(() => {
      mocks.dbUpdate.mockResolvedValue(ok(planSuccess()));
    });

    it('plans without applying and says so', async () => {
      const run = await harness().run(['db', 'update', '--dry-run'], {
        cwd: projectDir,
        isTty: { stdout: true },
      });
      const blocks = run.presented?.presentation.human ?? [];

      expect(mocks.dbUpdate).toHaveBeenCalledWith(expect.objectContaining({ mode: 'plan' }));
      expect(blocks[1]).toEqual({
        kind: 'summary',
        status: 'ok',
        text: 'Planned 1 operation(s) across 1 contract space',
      });
      expect(blocks.at(-1)).toEqual({
        kind: 'summary',
        status: 'info',
        tone: 'muted',
        text: 'This is a dry run. No changes were applied.',
      });
    });

    it('offers the apply as the next action', async () => {
      const run = await harness().run(['db', 'update', '--dry-run'], {
        cwd: projectDir,
        isTty: { stdout: true },
      });

      expect(run.presented?.presentation.next).toEqual([
        {
          kind: 'run-command',
          label: 'Apply the planned operations',
          command: 'prisma-test db update',
        },
      ]);
    });
  });

  it('takes the connection from --db over the config', async () => {
    await harness().run(['db', 'update', '--db', 'postgres://other/db', '--json'], {
      cwd: projectDir,
    });

    expect(mocks.connect).toHaveBeenCalledWith('postgres://other/db');
  });

  it('errors when no connection is configured', async () => {
    const run = await harness(ormConfig({ db: undefined })).run(['db', 'update', '--json'], {
      cwd: projectDir,
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CONFIG.DB_CONNECTION_REQUIRED' },
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('errors when the emitted contract is missing', async () => {
    const run = await harness(
      ormConfig({
        contract: {
          source: { format: 'typescript', inputs: [], load: async () => ({}) },
          output: join(projectDir, 'absent.json'),
        },
      }),
    ).run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'CLI.FILE_NOT_FOUND' },
    });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  it('maps a planning failure to its migration code', async () => {
    mocks.dbUpdate.mockResolvedValue(notOk(errorMigrationPlanningFailed({ conflicts: [] })));

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: { code: 'MIGRATION.PLANNING_FAILED' },
    });
  });

  describe('a contract default its data type refuses', () => {
    it('reports the planner`s CONTRACT.DEFAULT_INVALID, not an unexpected error', async () => {
      mocks.dbUpdate.mockRejectedValue(refusedDefault());

      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: {
          code: 'CONTRACT.DEFAULT_INVALID',
          summary: REFUSAL,
          meta: { reason: 'default-not-canonical', column: 'at' },
        },
      });
    });

    it('shows the refusal and the hint to re-emit', async () => {
      mocks.dbUpdate.mockRejectedValue(refusedDefault());

      const run = await harness().run(['db', 'update'], {
        cwd: projectDir,
        isTty: { stdout: true, stderr: true },
      });
      const shown = stripAnsi(run.stderr);

      expect(shown).toContain('CONTRACT.DEFAULT_INVALID');
      expect(shown).toContain(REFUSAL);
      expect(shown).not.toContain('Unexpected error');
    });
  });

  it('reports the planner`s warnings even when the apply fails', async () => {
    mocks.dbUpdate.mockImplementation(async (options: Parameters<ControlClient['dbUpdate']>[0]) => {
      options.onPlannerWarnings?.([
        { kind: 'suppressed', summary: 'control policy suppressed: table "auth.x"' },
      ]);
      return notOk(
        dbUpdateRunnerFailureError(
          migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'runner failed'),
          {},
          {
            databaseStorageHash: undefined,
            invocation: { cwd: projectDir, configPath: undefined, dbGiven: false },
          },
        ),
      );
    });

    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true, stderr: true },
    });

    expect(run.events).toContainEqual({
      kind: 'message',
      severity: 'warn',
      text: 'control policy suppressed: table "auth.x"',
    });
    expect(stripAnsi(run.stderr)).toContain('control policy suppressed: table "auth.x"');
  });

  it('repeats the statements of the run in the re-run it advises after a view blocks a drop', async () => {
    mocks.dbUpdate.mockImplementation(async (options: Parameters<ControlClient['dbUpdate']>[0]) =>
      notOk(
        dbUpdateRunnerFailureError(
          migrationRunnerFailure(
            'MIGRATION.EXECUTION_FAILED',
            'Table "billing"."Invoice" cannot be dropped while view billing.v_paid depends on it.',
            { meta: { blockingObjects: [{ kind: 'view', name: 'billing.v_paid' }] } },
          ),
          {},
          { databaseStorageHash: undefined, invocation: options.invocation },
        ),
      ),
    );

    const run = await harness().run(['db', 'update', '--delete', 'billing', '--json'], {
      cwd: projectDir,
    });

    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.EXECUTION_FAILED',
        nextActions: [
          {
            label:
              'Drop or change view billing.v_paid in the database yourself, then re-run `prisma-test db update --delete billing`',
          },
        ],
      },
    });
  });

  it('lists the planner`s warnings in the --json result of a successful run', async () => {
    mocks.dbUpdate.mockImplementation(async (options: Parameters<ControlClient['dbUpdate']>[0]) => {
      options.onPlannerWarnings?.([WARNING]);
      return ok(applySuccess());
    });

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });
    const frames = stdoutFrames(run.stdout);

    expect({
      exitCode: run.exitCode,
      messages: frames.filter((frame) => frame['kind'] === 'message'),
      warnings: (frames.at(-1) as { envelope: { result: { warnings: unknown } } }).envelope.result
        .warnings,
    }).toEqual({ exitCode: 0, messages: [], warnings: [WARNING] });
  });

  it('writes the planner`s warnings of a failed run as warn frames before the --json error', async () => {
    mocks.dbUpdate.mockImplementation(async (options: Parameters<ControlClient['dbUpdate']>[0]) => {
      options.onPlannerWarnings?.([WARNING]);
      return notOk(
        dbUpdateRunnerFailureError(
          migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'runner failed'),
          {},
          {
            databaseStorageHash: undefined,
            invocation: { cwd: projectDir, configPath: undefined, dbGiven: false },
          },
        ),
      );
    });

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });
    const frames = stdoutFrames(run.stdout);

    expect({
      exitCode: run.exitCode,
      kinds: frames.map((frame) => frame['kind']),
      first: frames[0],
    }).toEqual({
      exitCode: 2,
      kinds: ['message', 'result'],
      first: expect.objectContaining({ kind: 'message', severity: 'warn', text: WARNING.summary }),
    });
  });

  it('reports a contract the client refuses as a contract validation failure at the contract path', async () => {
    mocks.dbUpdate.mockRejectedValue(
      structuredError('CONTRACT.VALIDATION_FAILED', 'storage.storageHash is missing'),
    );

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: {
        code: 'CONTRACT.VALIDATION_FAILED',
        summary: 'Contract validation failed',
        why: expect.stringContaining('storage.storageHash is missing'),
      },
    });
  });

  it('links a runner failure to the reference entry of its code', async () => {
    mocks.dbUpdate.mockResolvedValue(
      notOk(
        dbUpdateRunnerFailureError(
          migrationRunnerFailure('MIGRATION.EXECUTION_FAILED', 'runner failed'),
          {},
          {
            databaseStorageHash: undefined,
            invocation: { cwd: projectDir, configPath: undefined, dbGiven: false },
          },
        ),
      ),
    );

    const run = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true, stderr: true },
    });

    expect(stripAnsi(run.stderr)).toContain(`docs: ${docsUrlFor('MIGRATION.EXECUTION_FAILED')}`);
  });

  it('reports a runner failure with the runner code and meta, and the advice', async () => {
    const runnerFailure = migrationRunnerFailure(
      'MIGRATION.SCHEMA_VERIFY_FAILED',
      'Database schema does not satisfy contract',
      {
        why: schemaCheckWhy([MISSING_COLUMN]),
        meta: { schemaIssues: [MISSING_COLUMN], failingSpace: 'app' },
      },
    );
    mocks.dbUpdate.mockResolvedValue(
      notOk(
        dbUpdateRunnerFailureError(runnerFailure, runnerFailureFacts(runnerFailure, []), {
          databaseStorageHash: undefined,
          invocation: { cwd: projectDir, configPath: undefined, dbGiven: false },
        }),
      ),
    );

    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({
      ok: false,
      error: {
        code: 'MIGRATION.SCHEMA_VERIFY_FAILED',
        summary: 'Database schema does not satisfy contract',
        why: 'The schema check after apply found: missing: public/event/id.',
        nextActions: [
          {
            kind: 'edit-file',
            label:
              'Change the contract source to resolve the issues listed, re-run `prisma-test contract emit`, then re-run `prisma-test db update`',
          },
        ],
        meta: { schemaIssues: [{ path: ['public', 'event', 'id'] }], failingSpace: 'app' },
      },
    });
    expect(stdoutErrorMeta(run.stdout)).toEqual(JSON.parse(JSON.stringify(runnerFailure.meta)));
    expect(mocks.dbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        invocation: {
          cwd: projectDir,
          configPath: undefined,
          dbGiven: false,
          rerunArgs: [],
          statementArgs: [],
        },
      }),
    );
  });

  it('refuses a --to reference no migration package produces', async () => {
    const run = await harness().run(['db', 'update', '--to', 'nope', '--json'], {
      cwd: projectDir,
    });

    expect(run.exitCode).toBe(2);
    expect(envelopeOf(run.json)).toMatchObject({ ok: false, error: { code: expect.any(String) } });
    expect(mocks.connect).not.toHaveBeenCalled();
  });

  describe('a connection that fails', () => {
    it('keeps the connection string out of the settled error', async () => {
      mocks.connect.mockRejectedValue(new Error(`connect ECONNREFUSED for ${CONNECTION}`));

      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).not.toContain('secret');
      expect(settled).toContain('ECONNREFUSED');
    });

    it('reports the connection failure rather than the failure to hang up', async () => {
      mocks.connect.mockRejectedValue(new Error('ECONNREFUSED 127.0.0.1:5432'));
      mocks.close.mockRejectedValue(new Error('close on an unconnected client'));

      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });
      const settled = JSON.stringify(run.json.at(-1));

      expect(run.exitCode).toBe(2);
      expect(settled).toContain('ECONNREFUSED 127.0.0.1:5432');
      expect(settled).not.toContain('close on an unconnected client');
    });
  });

  describe('ref advancement', () => {
    it('renders the snapshot types from the contract before touching the database', async () => {
      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(0);
      expect(mocks.renderContractDts).toHaveBeenCalledWith({
        contract: { storage: { storageHash: MARKER_HASH } },
        resolveImportSpecifier: expect.any(Function),
      });
      expect(mocks.renderContractDts.mock.invocationCallOrder[0]).toBeLessThan(
        mocks.connect.mock.invocationCallOrder[0]!,
      );
      const storeDir = contractSnapshotDir(join(projectDir, 'migrations'), MARKER_HASH);
      expect(await readFile(join(storeDir, 'contract.d.ts'), 'utf-8')).toBe(RENDERED_CONTRACT_DTS);
    });

    it('refuses before connecting when the contract types cannot be rendered', async () => {
      mocks.renderContractDts.mockResolvedValue(
        notOk({
          code: 'RENDER_FAILED',
          summary: 'Failed to render contract types',
          why: 'relation author must declare nullability',
        }),
      );

      const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

      expect(run.exitCode).toBe(2);
      expect(envelopeOf(run.json)).toMatchObject({
        ok: false,
        error: { code: 'CONTRACT.TYPES_RENDER_FAILED' },
      });
      expect(JSON.stringify(run.json.at(-1))).toContain('relation author must declare nullability');
      expect(mocks.connect).not.toHaveBeenCalled();
      expect(mocks.dbUpdate).not.toHaveBeenCalled();
      expect(existsSync(join(projectDir, 'migrations'))).toBe(false);
    });

    it('does not render when --db leaves the ref alone', async () => {
      const run = await harness().run(
        [...['db', 'update', '--json'], '--db', 'postgres://user:secret@localhost:5432/other'],
        { cwd: projectDir },
      );

      expect(run.exitCode).toBe(0);
      expect(mocks.renderContractDts).not.toHaveBeenCalled();
      expect(run.presented?.data).toMatchObject({ advancedRef: null });
    });
  });
});
