import { rmSync } from 'node:fs';
import { asNamespaceId, type Contract, type ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  MigrationPlannerResult,
  ResolvedMigrationStatement,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { join } from 'pathe';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { executeDbUpdate } from '../../src/control-api/operations/db-update';
import { createTestProjectDir } from '../utils/test-project-dir';

const TEST_INVOCATION = { cwd: '/work/app', configPath: undefined, dbGiven: false };

const ORIGIN_HASH = 'a'.repeat(64);
const DESTINATION_HASH = 'b'.repeat(64);

function contractWithModels(storageHash: string, models: readonly string[]): Contract {
  return {
    schemaVersion: '1',
    target: 'postgres',
    targetFamily: 'sql',
    storage: { storageHash, tables: {}, namespaces: {} },
    domain: {
      namespaces: {
        app: {
          models: Object.fromEntries(
            models.map((model) => [
              model,
              { fields: { nickname: {} }, relations: {}, storage: {} },
            ]),
          ),
        },
      },
    },
  } as unknown as Contract;
}

const origin = contractWithModels(ORIGIN_HASH, ['Profile']);
const destination = contractWithModels(DESTINATION_HASH, ['User']);

const marker: ContractMarkerRecord = {
  storageHash: ORIGIN_HASH,
  profileHash: '',
  contractJson: null,
  canonicalVersion: null,
  updatedAt: new Date(0),
  appTag: null,
  meta: {},
  invariants: [],
};

const family = {
  familyId: 'sql',
  readAllMarkers: async () => new Map([['app', marker]]),
  introspect: async () => ({ tables: {} }),
  deserializeContract: (json: unknown) => json as Contract,
  toOperationPreview: () => ({ statements: [] }),
} as unknown as ControlFamilyInstance<'sql', unknown>;

const app = asNamespaceId('app');

/** Without statements, the plan drops `Profile` and its `nickname`; with a rename, it refuses it, to be written by hand. */
const migrations = {
  createPlanner: () => ({
    plan: (options: {
      readonly origin: { readonly storageHash: string } | null;
      readonly statements: readonly ResolvedMigrationStatement[];
    }): MigrationPlannerResult =>
      options.statements.length > 0
        ? {
            kind: 'failure',
            conflicts: [
              {
                kind: 'rewriteByHand',
                summary: 'The rename needs rewrites the planner does not write',
                leaveOut: options.statements,
              },
            ],
          }
        : {
            kind: 'success',
            appliedStatements: [],
            dataLoss: [
              {
                operationIndex: 0,
                subject: { kind: 'field', namespaceId: app, model: 'Profile', field: 'nickname' },
                loss: 'drop',
                label: 'Drop column nickname',
              },
              {
                operationIndex: 0,
                subject: { kind: 'model', namespaceId: app, model: 'Profile' },
                loss: 'drop',
                label: 'Drop table Profile',
              },
            ],
            accessChanges: [],
            temporaryValues: [],
            plan: {
              targetId: 'postgres',
              origin: options.origin,
              destination: { storageHash: DESTINATION_HASH },
              operations: [
                { id: 'dropTable.Profile', label: 'Drop table', operationClass: 'destructive' },
              ],
              renderTypeScript: () => '',
            },
          },
  }),
  createRunner: () => ({ execute: vi.fn() }),
} as unknown as TargetMigrationsCapability<
  'sql',
  'postgres',
  ControlFamilyInstance<'sql', unknown>
>;

const tempDirs: string[] = [];
afterEach(() => {
  for (const dir of tempDirs.splice(0)) rmSync(dir, { recursive: true, force: true });
});

describe('executeDbUpdate when the plan with an answered rename is refused', () => {
  it('advises the plan without the rename typed at the prompt, keeping the given delete', async () => {
    const dir = createTestProjectDir('db-update-refused-replan');
    tempDirs.push(dir);
    const migrationsDir = join(dir, 'migrations');
    await writeContractSnapshot(migrationsDir, ORIGIN_HASH, {
      contractJson: origin,
      contractDts: '',
    });

    const result = await executeDbUpdate({
      invocation: TEST_INVOCATION,
      driver: { close: vi.fn() } as unknown as ControlDriverInstance<'sql', 'postgres'>,
      adapter: {} as unknown as ControlAdapterInstance<'sql', 'postgres'>,
      familyInstance: family,
      contract: destination,
      mode: 'apply',
      migrations,
      frameworkComponents: [],
      migrationsDir,
      answerQuestions: async (questions) =>
        questions.map(() => ({ verb: 'rename', text: 'Profile:User' })),
      targetId: 'postgres',
      statements: [{ verb: 'delete', text: 'Profile.nickname' }],
    });

    expect(result.ok ? undefined : result.failure.nextActions).toEqual([
      {
        kind: 'user-choice',
        label:
          'To write the rewrites by hand, plan the change without --rename Profile:User with `{bin} migration plan --delete Profile.nickname`, add the rewrites the message describes to the migration.ts it writes, run `node <migration directory>/migration.ts` for the directory it writes, and apply it with `{bin} db migrate`',
      },
    ]);
  });
});
