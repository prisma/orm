import { rmSync, writeFileSync } from 'node:fs';
import { asNamespaceId } from '@internal/contract/types';
import { ok } from '@internal/utils/result';
import type { StreamEvent } from '@prisma/cli-engine';
import { join } from 'pathe';
import { type Mock, vi } from 'vitest';
import {
  accessChangeQuestion,
  dataLossQuestion,
  type PlanAnswer,
  type PlanQuestion,
} from '../../../src/control-api/statements/plan-questions';
import type { ControlClient, DbUpdateOptions } from '../../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../../src/orm/cli';
import { createOrmTestCli } from '../../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../../utils/test-project-dir';

export const mocks: Readonly<
  Record<'connect' | 'readMarker' | 'dbUpdate' | 'renderContractDts' | 'close', Mock>
> = {
  connect: vi.fn(),
  readMarker: vi.fn(),
  dbUpdate: vi.fn(),
  renderContractDts: vi.fn(),
  close: vi.fn(),
};

/** The command tree mounted over a control-client double instead of the real client. */
const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      readMarker: mocks.readMarker,
      dbUpdate: mocks.dbUpdate,
      renderContractDts: mocks.renderContractDts,
      close: mocks.close,
    }) as unknown as ControlClient,
);
const groups = BIN_GROUPS;

/** Removes every project directory the tests made. */
export function removeProjects(): void {
  for (const dir of projectDirs.splice(0)) {
    rmSync(dir, { recursive: true, force: true });
  }
}

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };

const DEST_HASH = 'd'.repeat(64);
const MARKER_HASH = 'a'.repeat(64);
const CONNECTION = 'postgres://user:secret@localhost:5432/appdb';

/** The project directory of the running test. */
export const project = { dir: '' };
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
  storage: { namespaces: {} },
};
const destination = {
  domain: { namespaces: { app: { models: { User: { fields: {}, relations: {}, storage: {} } } } } },
  storage: { namespaces: {} },
};
export const contracts = {
  origin,
  destination,
  statements: [],
  canConvert: false,
  originKnown: true,
  temporaryValues: [],
};

/** One question of each kind, across two spaces: an extension's recorded drop is a storage subject. */
export function planQuestions(): readonly PlanQuestion[] {
  return [
    dataLossQuestion(
      {
        operationIndex: 0,
        label: 'Drop table "audit_old"',
        subject: { kind: 'storage', name: 'audit_old' },
        loss: 'drop',
      },
      contracts,
    ),
    dataLossQuestion(
      {
        operationIndex: 1,
        label: 'Drop table "Legacy"',
        subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'Legacy' },
        loss: 'drop',
      },
      contracts,
    ),
    accessChangeQuestion(
      [
        {
          operationIndex: 2,
          label: 'Disable row-level security on "User"',
          subject: { kind: 'model', namespaceId: asNamespaceId('app'), model: 'User' },
          widens: true,
        },
      ],
      contracts,
    ),
  ];
}

/** The control API's shape: an apply asks its questions, then applies; a dry run asks nothing. */
export function askThenApply(questions: () => readonly PlanQuestion[]) {
  return async (options: DbUpdateOptions) => {
    if (options.mode === 'apply') {
      answers.push(...(await options.answerQuestions(questions())));
    }
    return ok(applySuccess(options.mode));
  };
}

export const answers: (PlanAnswer | undefined)[] = [];

/** A fresh project directory, a control client that asks one question of each kind, and no answers yet. */
export function setUpProject(): void {
  project.dir = createTestProjectDir('orm-db-update-consent');
  projectDirs.push(project.dir);
  writeProjectManifest(project.dir);
  writeFileSync(
    join(project.dir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: MARKER_HASH } }),
  );
  writeFileSync(join(project.dir, 'contract.d.ts'), 'export type Contract = never;\n');
  answers.splice(0);
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.readMarker.mockReset().mockResolvedValue(null);
  mocks.close.mockReset().mockResolvedValue(undefined);
  mocks.dbUpdate.mockReset().mockImplementation(askThenApply(planQuestions));
  mocks.renderContractDts
    .mockReset()
    .mockResolvedValue(ok({ contractDts: 'export type Contract = never;\n' }));
}

export function ormConfig(overrides: Record<string, unknown> = {}): Record<string, unknown> {
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
      output: join(project.dir, 'contract.json'),
      typesModule: '@acme/orm-db/contract-types',
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
    accessChanges: [],
    temporaryValues: [],
    summary: 'Database updated',
  };
}

export function harness(config: Record<string, unknown> = ormConfig()) {
  return createOrmTestCli({ commands, groups, orm: config });
}

export function envelopeOf(json: readonly StreamEvent[]): unknown {
  const terminal = json.at(-1);
  return terminal?.kind === 'result' ? terminal.envelope : undefined;
}
