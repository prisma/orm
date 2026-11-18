import { rmSync, writeFileSync } from 'node:fs';
import { ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const mocks = { connect: vi.fn(), dbUpdate: vi.fn(), renderContractDts: vi.fn(), close: vi.fn() };

const commands = createBinCommands(
  () =>
    ({
      connect: mocks.connect,
      dbUpdate: mocks.dbUpdate,
      renderContractDts: mocks.renderContractDts,
      close: mocks.close,
    }) as unknown as ControlClient,
);

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };
const DEST_HASH = 'd'.repeat(64);

let projectDir: string;
const projectDirs: string[] = [];

afterAll(() => {
  for (const dir of projectDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

beforeEach(() => {
  projectDir = createTestProjectDir('orm-db-update-permitted');
  projectDirs.push(projectDir);
  writeProjectManifest(projectDir);
  writeFileSync(
    join(projectDir, 'contract.json'),
    JSON.stringify({ storage: { storageHash: DEST_HASH } }),
  );
  writeFileSync(join(projectDir, 'contract.d.ts'), 'export type Contract = never;\n');
  mocks.renderContractDts
    .mockReset()
    .mockResolvedValue(ok({ contractDts: 'export type Contract = never;\n' }));
  mocks.connect.mockReset().mockResolvedValue(undefined);
  mocks.close.mockReset().mockResolvedValue(undefined);
});

function harness() {
  return createOrmTestCli({
    commands,
    groups: BIN_GROUPS,
    orm: {
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
      db: { connection: 'postgres://user:secret@localhost:5432/appdb' },
      contract: {
        source: { format: 'typescript', inputs: [], load: async () => ({}) },
        output: join(projectDir, 'contract.json'),
        typesModule: '@acme/orm-db/contract-types',
      },
    },
  });
}

const legacy = { kind: 'field', namespaceId: 'app', model: 'User', field: 'legacy' } as const;
const user = { kind: 'model', namespaceId: 'app', model: 'User' } as const;

/** A dry run of a plan that drops a field and disables row-level security, on a database that permits both. */
function permittedPlan(): Record<string, unknown> {
  return {
    mode: 'plan',
    appliedStatements: [],
    temporaryValues: [],
    dataLoss: [{ operationIndex: 0, subject: legacy, text: 'User.legacy', loss: 'drop' }],
    accessChanges: [{ operationIndex: 1, subject: user, text: 'User', widens: true }],
    permitted: ['dataLoss', 'accessWidening'],
    destination: { storageHash: DEST_HASH },
    plan: {
      operations: [
        { id: 'column.user.legacy', label: 'Drop column "legacy"', operationClass: 'destructive' },
        { id: 'rls.user', label: 'Disable row-level security', operationClass: 'widening' },
      ],
    },
    perSpace: [],
    summary: 'Planned 2 operations',
  };
}

describe('db update --dry-run on a database whose data protection policy permits the changes', () => {
  it('says nothing is asked, in its output and its JSON, and advises an apply without flags', async () => {
    mocks.dbUpdate.mockResolvedValue(ok(permittedPlan()));

    const human = await harness().run(['db', 'update', '--dry-run'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const json = await harness().run(['db', 'update', '--dry-run', '--json'], { cwd: projectDir });

    expect({
      asks: JSON.stringify(human.presented?.presentation.human).includes('An apply asks about'),
      nextActions: human.presented?.presentation.next,
      data: json.presented?.data,
    }).toMatchObject({
      asks: false,
      nextActions: [{ kind: 'run-command', command: 'prisma-test db update' }],
      data: {
        permitted: ['dataLoss', 'accessWidening'],
        dataLoss: [{ text: 'User.legacy', answered: true }],
        accessChanges: [{ text: 'User', answered: true }],
      },
    });
  });

  it('marks only the permitted setting answered, and still lists what an apply asks about the other', async () => {
    mocks.dbUpdate.mockResolvedValue(ok({ ...permittedPlan(), permitted: ['dataLoss'] }));

    const human = await harness().run(['db', 'update', '--dry-run'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const json = await harness().run(['db', 'update', '--dry-run', '--json'], { cwd: projectDir });

    expect({
      asks: human.presented?.presentation.human.filter((block) =>
        JSON.stringify(block).includes('An apply asks about'),
      ),
      data: json.presented?.data,
    }).toMatchObject({
      asks: [
        {
          kind: 'tree',
          roots: [
            {
              label: 'An apply asks about',
              children: [{ label: 'Disable row-level security: --allow User' }],
            },
          ],
        },
      ],
      data: {
        dataLoss: [{ text: 'User.legacy', answered: true }],
        accessChanges: [{ text: 'User', answered: false }],
      },
    });
  });

  it('says on an apply that the policy permitted the deletes it applied, in its output and its JSON', async () => {
    mocks.dbUpdate.mockResolvedValue(
      ok({
        ...permittedPlan(),
        mode: 'apply',
        permitted: ['dataLoss'],
        accessChanges: [],
        appliedStatements: [
          {
            verb: 'delete',
            statement: { kind: 'delete', subject: legacy },
            description: 'delete field "User.legacy"',
            operationIndexes: [0],
          },
        ],
        execution: { operationsPlanned: 1, operationsExecuted: 1 },
        marker: { storageHash: DEST_HASH },
      }),
    );

    const human = await harness().run(['db', 'update'], {
      cwd: projectDir,
      isTty: { stdout: true },
    });
    const json = await harness().run(['db', 'update', '--json'], { cwd: projectDir });

    expect({
      human: human.presented?.presentation.human,
      permitted: (json.presented?.data as { permitted?: unknown } | undefined)?.permitted,
    }).toMatchObject({
      human: expect.arrayContaining([
        {
          kind: 'summary',
          status: 'info',
          text: "This database's data protection policy permits losing data, so these deletes were applied without asking.",
        },
      ]),
      permitted: ['dataLoss'],
    });
  });
});
