import { rmSync, writeFileSync } from 'node:fs';
import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import type { StreamEvent } from '@prisma/cli-engine';
import { join } from 'pathe';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  accessWideningQuestion,
  dataLossQuestion,
  type PlanAnswer,
  type PlanQuestion,
} from '../../src/control-api/statements/plan-questions';
import type { ControlClient, DbUpdateOptions } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const mocks = {
  connect: vi.fn(),
  dbUpdate: vi.fn(),
  renderContractDts: vi.fn(),
  close: vi.fn(),
};

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

/** The contracts the questions name subjects in: the origin has Legacy and User, the destination User. */
const origin = {
  domain: {
    namespaces: {
      app: {
        models: {
          Legacy: { fields: {}, relations: {}, storage: {} },
          User: { fields: {}, relations: {}, storage: {} },
        },
      },
    },
  },
};
const destination = {
  domain: { namespaces: { app: { models: { User: { fields: {}, relations: {}, storage: {} } } } } },
};
const contracts = {
  origin,
  destination,
  renames: [],
  originKnown: true,
  keepDataByHand: undefined,
};

/** One question of each kind, across two spaces: an extension's recorded drop is a storage subject. */
function planQuestions(): readonly PlanQuestion[] {
  return [
    dataLossQuestion(
      {
        operationIndex: 0,
        label: 'Drop table "audit_old"',
        subject: { kind: 'storage', name: 'audit_old' },
      },
      contracts,
    ),
    dataLossQuestion(
      {
        operationIndex: 1,
        label: 'Drop table "Legacy"',
        subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'Legacy' },
      },
      contracts,
    ),
    accessWideningQuestion(
      {
        operationIndex: 2,
        label: 'Disable row-level security on "User"',
        subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'User' },
        widens: true,
      },
      contracts,
    ),
  ];
}

/** The control API's shape: an apply asks its questions, then applies; a dry run asks nothing. */
function askThenApply(questions: () => readonly PlanQuestion[]) {
  return async (options: DbUpdateOptions) => {
    if (options.mode === 'apply') {
      answers.push(...(await options.answerQuestions(questions())));
    }
    return ok(applySuccess(options.mode));
  };
}

const answers: PlanAnswer[] = [];

beforeEach(() => {
  projectDir = createTestProjectDir('orm-db-update-consent');
  projectDirs.push(projectDir);
  writeProjectManifest(projectDir);
  writeFileSync(
    join(projectDir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: MARKER_HASH } }),
  );
  writeFileSync(join(projectDir, 'contract.d.ts'), 'export type Contract = never;\n');
  answers.splice(0);
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.dbUpdate.mockReset().mockImplementation(askThenApply(planQuestions));
  mocks.renderContractDts
    .mockReset()
    .mockResolvedValue(ok({ contractDts: 'export type Contract = never;\n' }));
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

function applySuccess(mode: 'plan' | 'apply'): Record<string, unknown> {
  return {
    mode,
    destination: { storageHash: DEST_HASH },
    plan: {
      operations: [{ id: 'op-2', label: 'Drop table "Legacy"', operationClass: 'destructive' }],
    },
    ...(mode === 'apply' ? { execution: { operationsPlanned: 1, operationsExecuted: 1 } } : {}),
    marker: { storageHash: MARKER_HASH },
    appliedStatements: [],
    dataLoss: [],
    accessWidening: [],
    summary: 'Database updated',
  };
}

function harness(config: Record<string, unknown> = ormConfig()) {
  return createOrmTestCli({ commands, groups, orm: config });
}

function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}

describe('db update questions', () => {
  it('refuses where nobody can answer, listing every question across spaces with its flags', async () => {
    const run = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect(run.exitCode).toBe(2);
    const envelope = envelopeOf(run.json) as {
      readonly error: { readonly code: string; readonly nextActions: unknown };
    };
    expect(envelope.error.code).toBe('CLI.CONSENT_REQUIRED');
    const actions = JSON.stringify(envelope.error.nextActions);
    for (const flag of [
      '--delete audit_old',
      '--delete Legacy',
      "--rename 'Legacy:<new name>'",
      '--allow User',
    ]) {
      expect(actions).toContain(flag);
    }
    expect(actions).not.toContain('--rename audit_old');
    expect(actions).not.toContain('--delete User');
  });

  it('gives a value the subject it equals when another subject is its prefix', async () => {
    mocks.dbUpdate.mockImplementation(
      askThenApply(() => [
        dataLossQuestion(
          {
            operationIndex: 0,
            label: 'Drop table "Legacy"',
            subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'Legacy' },
          },
          contracts,
        ),
        dataLossQuestion(
          {
            operationIndex: 1,
            label: 'Drop table "Legacy:x"',
            subject: { kind: 'storage', name: 'Legacy:x' },
          },
          contracts,
        ),
      ]),
    );

    const run = await harness().run(
      ['db', 'update', '--delete', 'Legacy:x', '--delete', 'Legacy', '--json'],
      { cwd: projectDir },
    );

    expect(run.exitCode).toBe(0);
    expect(answers).toEqual([
      { verb: 'delete', text: 'Legacy' },
      { verb: 'delete', text: 'Legacy:x' },
    ]);
  });

  it('applies once every question is answered with flags', async () => {
    const run = await harness().run(
      ['db', 'update', '--delete', 'audit_old', '--delete', 'Legacy', '--allow', 'User', '--json'],
      { cwd: projectDir },
    );

    expect(run.exitCode).toBe(0);
    expect(answers).toEqual([
      { verb: 'delete', text: 'audit_old' },
      { verb: 'delete', text: 'Legacy' },
      { verb: 'allow', text: 'User' },
    ]);
  });

  it('refuses an apply that widens access without --allow', async () => {
    const run = await harness().run(
      ['db', 'update', '--delete', 'audit_old', '--delete', 'Legacy', '--json'],
      { cwd: projectDir },
    );

    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'CLI.CONSENT_REQUIRED',
        meta: { unanswered: [{ subject: 'User', verbs: ['allow'] }] },
      },
    });
  });

  it('takes typed answers', async () => {
    const run = await harness().run(['db', 'update', '--json'], {
      cwd: projectDir,
      isTty: { stdin: true },
      answers: ['delete', 'delete', 'allow'],
    });

    expect(run.exitCode).toBe(0);
    expect(answers.map(({ verb }) => verb)).toEqual(['delete', 'delete', 'allow']);
  });

  it('does not take --confirm or --yes as an answer', async () => {
    const confirmed = await harness().run(['db', 'update', '--confirm', 'appdb', '--json'], {
      cwd: projectDir,
    });
    const yes = await harness().run(['db', 'update', '--yes', '--json'], {
      cwd: projectDir,
      isTty: { stdin: true },
    });

    expect([envelopeOf(confirmed.json), envelopeOf(yes.json)]).toMatchObject([
      { error: { code: 'CLI.CONSENT_REQUIRED' } },
      { error: { code: 'CLI.CONSENT_REQUIRED' } },
    ]);
  });

  it('refuses a --delete no question asks about', async () => {
    mocks.dbUpdate.mockReset().mockImplementation(askThenApply(() => []));

    const run = await harness().run(['db', 'update', '--delete', 'Nope', '--json'], {
      cwd: projectDir,
    });

    expect(envelopeOf(run.json)).toMatchObject({ error: { code: 'CLI.CONSENT_UNUSED' } });
  });

  it('asks nothing on a dry run, and hands it the delete and allow flags to check', async () => {
    const run = await harness().run(
      ['db', 'update', '--dry-run', '--delete', 'Legacy', '--allow', 'User', '--json'],
      { cwd: projectDir },
    );

    expect(run.exitCode).toBe(0);
    expect(answers).toEqual([]);
    expect(mocks.dbUpdate).toHaveBeenCalledWith(
      expect.objectContaining({
        mode: 'plan',
        statements: [
          { verb: 'delete', text: 'Legacy' },
          { verb: 'allow', text: 'User' },
        ],
      }),
    );
  });

  it('keeps every statement in the retry command when no connection is configured', async () => {
    const run = await harness({ ...ormConfig(), db: undefined }).run(
      [
        'db',
        'update',
        '--rename',
        'Profile:User',
        '--delete',
        'Legacy',
        '--allow',
        'User',
        '--json',
      ],
      { cwd: projectDir },
    );

    expect(envelopeOf(run.json)).toMatchObject({
      error: {
        code: 'CONFIG.DB_CONNECTION_REQUIRED',
        nextActions: [
          expect.objectContaining({
            label: expect.stringContaining(
              'prisma-test db update --rename Profile:User --delete Legacy --allow User --db $DATABASE_URL',
            ),
          }),
        ],
      },
    });
  });
});
