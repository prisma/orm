import { rmSync, writeFileSync } from 'node:fs';
import { ok } from '@internal/utils/result';
import { join } from 'pathe';
import { afterAll, describe, expect, it, vi } from 'vitest';
import type { ControlClient } from '../../src/control-api/types';
import { BIN_GROUPS, createBinCommands } from '../../src/orm/cli';
import { createOrmTestCli } from '../helpers/orm-test-cli';
import { createTestProjectDir, writeProjectManifest } from '../utils/test-project-dir';

const DESCRIPTOR = { familyId: 'sql', targetId: 'postgres', version: '1.0.0', create: () => ({}) };
const HASH = 'a'.repeat(64);
const projectDirs: string[] = [];

afterAll(() => {
  for (const dir of projectDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

function project(): string {
  const dir = createTestProjectDir('orm-db-update-dry-run-allow');
  projectDirs.push(dir);
  writeProjectManifest(dir);
  writeFileSync(join(dir, 'contract.json'), JSON.stringify({ storage: { storageHash: HASH } }));
  writeFileSync(join(dir, 'contract.d.ts'), 'export type Contract = never;\n');
  return dir;
}

function harness(dir: string, planned: Record<string, unknown>) {
  const client = {
    connect: vi.fn(async () => undefined),
    close: vi.fn(async () => undefined),
    dbUpdate: vi.fn(async () => ok(planned)),
    renderContractDts: vi.fn(async () => ok({ contractDts: 'export type Contract = never;\n' })),
  } as unknown as ControlClient;
  return createOrmTestCli({
    commands: createBinCommands(() => client),
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
        output: join(dir, 'contract.json'),
        typesModule: '@acme/orm-db/contract-types',
      },
    },
  });
}

describe('a dry run given one --allow for two access changes of a model', () => {
  it('lists both operations on one line answered by the flag, and marks each change answered', async () => {
    const dir = project();
    const user = { kind: 'model', namespaceId: 'app', model: 'User' } as const;
    const operations = [
      { id: 'rls', label: 'Disable row-level security on "user"', operationClass: 'widening' },
      { id: 'policy', label: 'Drop RLS policy "readers" on "user"', operationClass: 'widening' },
    ];
    const planned = {
      mode: 'plan',
      appliedStatements: [],
      dataLoss: [],
      accessChanges: [
        { operationIndex: 0, subject: user, text: 'User' },
        { operationIndex: 1, subject: user, text: 'User' },
      ],
      destination: { storageHash: HASH },
      plan: { operations },
      perSpace: [{ spaceId: 'app', kind: 'app', operations }],
      summary: 'Planned 2 operations',
    };

    const run = await harness(dir, planned).run(['db', 'update', '--dry-run', '--allow', 'User'], {
      cwd: dir,
      isTty: { stdout: true },
    });
    const data = run.presented?.data as { readonly accessChanges?: readonly unknown[] };

    expect({
      tree: run.presented?.presentation.human.find(
        (block) => block.kind === 'tree' && block.roots[0]?.label === 'An apply asks about',
      ),
      accessChanges: data.accessChanges,
    }).toEqual({
      tree: {
        kind: 'tree',
        roots: [
          {
            label: 'An apply asks about',
            children: [
              {
                label:
                  'Disable row-level security on "user" and drop RLS policy "readers" on "user": --allow User (answered)',
              },
            ],
          },
        ],
      },
      accessChanges: [
        {
          operationIndex: 0,
          subject: user,
          text: 'User',
          answered: true,
          answeredBy: { verb: 'allow', text: 'User' },
        },
        {
          operationIndex: 1,
          subject: user,
          text: 'User',
          answered: true,
          answeredBy: { verb: 'allow', text: 'User' },
        },
      ],
    });
  });
});
