import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { executeDbUpdate } from '@internal/cli/control-api';
import type { Contract, ContractMarkerRecord } from '@internal/contract/types';
import type {
  ControlAdapterInstance,
  ControlDriverInstance,
  ControlFamilyInstance,
  TargetMigrationsCapability,
} from '@internal/framework-components/control';
import { writeContractSnapshot } from '@internal/migration-tools/contract-snapshot-store';
import { MongoCollection } from '@internal/mongo-contract';
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { mongoTargetDescriptor } from '../src/core/migrations/control-target';
import { contract as fixtureContract, schemaCollection } from './mongo-statement-fixtures';

const TEST_INVOCATION = { cwd: process.cwd(), configPath: undefined, dbGiven: false };

const ORIGIN_HASH = 'a'.repeat(64);
const DESTINATION_HASH = 'b'.repeat(64);

function contractWithModel(storageHash: string, model: string): Contract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    storage: {
      storageHash,
      namespaces: {
        app: {
          id: 'app',
          kind: 'mongo-namespace',
          entries: { collection: { [model]: new MongoCollection({}) } },
        },
      },
    },
    domain: {
      namespaces: {
        app: {
          models: {
            [model]: { fields: {}, relations: {}, storage: { collection: model, fields: {} } },
          },
        },
      },
    },
  } as unknown as Contract;
}

const origin = contractWithModel(ORIGIN_HASH, 'Profile');
const destination = contractWithModel(DESTINATION_HASH, 'User');

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
  familyId: 'mongo',
  readAllMarkers: async () => new Map([['app', marker]]),
  introspect: async () =>
    new MongoSchemaIR([new MongoSchemaCollection({ name: 'Profile' })], { fromDatabase: false }),
  deserializeContract: (json: unknown) => json as Contract,
  toOperationPreview: () => ({ statements: [] }),
} as unknown as ControlFamilyInstance<'mongo', unknown>;

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('db update with statements on MongoDB', () => {
  it('plans the collection rename the statement states, and nothing that loses data', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mongo-db-update-statements-'));
    tempDirs.push(dir);
    const migrationsDir = join(dir, 'migrations');
    await writeContractSnapshot(migrationsDir, ORIGIN_HASH, {
      contractJson: origin,
      contractDts: '',
    });

    const result = await executeDbUpdate({
      invocation: TEST_INVOCATION,
      answerQuestions: async (questions) =>
        questions.map((question) => ({
          verb: question.verbs.includes('allow') ? ('allow' as const) : ('delete' as const),
          text: question.subject,
        })),
      driver: {
        close: async () => {},
        databaseName: async () => 'appdb',
      } as unknown as ControlDriverInstance<'mongo', 'mongo'>,
      adapter: {} as unknown as ControlAdapterInstance<'mongo', 'mongo'>,
      familyInstance: family,
      contract: destination,
      mode: 'plan',
      migrations: mongoTargetDescriptor.migrations as unknown as TargetMigrationsCapability<
        'mongo',
        'mongo',
        ControlFamilyInstance<'mongo', unknown>
      >,
      frameworkComponents: [],
      migrationsDir,
      targetId: 'mongo',
      statements: [{ verb: 'rename', text: 'Profile:User' }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        appliedStatements: [
          { statement: { entity: 'model', from: { model: 'Profile' } }, operationIndexes: [0] },
        ],
        dataLoss: [],
        plan: {
          operations: [
            {
              id: 'collection.Profile.rename(User)',
              label: 'Rename collection Profile to User',
              operationClass: 'widening',
            },
          ],
        },
      },
    });
  });

  it('removes the field --delete names from the collection the plan renames', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mongo-db-update-statements-'));
    tempDirs.push(dir);
    const migrationsDir = join(dir, 'migrations');
    const from = fixtureContract(
      'from',
      { User: { collection: 'users', fields: ['_id', 'email', 'name'] } },
      { users: { required: ['email', 'name'] } },
    );
    const to = fixtureContract(
      'to',
      { User: { collection: 'app_users', fields: ['_id', 'email'] } },
      { app_users: { required: ['email'] } },
    );
    await writeContractSnapshot(migrationsDir, from.storage.storageHash, {
      contractJson: from,
      contractDts: '',
    });
    const result = await executeDbUpdate({
      invocation: TEST_INVOCATION,
      answerQuestions: async () => {
        throw new Error('no question is asked');
      },
      driver: {
        close: async () => {},
        databaseName: async () => 'appdb',
      } as unknown as ControlDriverInstance<'mongo', 'mongo'>,
      adapter: {} as unknown as ControlAdapterInstance<'mongo', 'mongo'>,
      familyInstance: {
        ...family,
        readAllMarkers: async () =>
          new Map([['app', { ...marker, storageHash: from.storage.storageHash }]]),
        introspect: async () =>
          new MongoSchemaIR([schemaCollection('users', { required: ['email', 'name'] })], {
            fromDatabase: false,
          }),
      } as unknown as ControlFamilyInstance<'mongo', unknown>,
      contract: to,
      mode: 'plan',
      migrations: mongoTargetDescriptor.migrations as unknown as TargetMigrationsCapability<
        'mongo',
        'mongo',
        ControlFamilyInstance<'mongo', unknown>
      >,
      frameworkComponents: [],
      migrationsDir,
      targetId: 'mongo',
      statements: [{ verb: 'delete', text: 'User.name' }],
    });

    expect(result).toMatchObject({
      ok: true,
      value: {
        appliedStatements: [
          {
            statement: { kind: 'delete', subject: { kind: 'field', model: 'User', field: 'name' } },
            operationIndexes: [1],
          },
        ],
        plan: {
          operations: [
            { label: 'Rename collection users to app_users' },
            { label: 'Remove field name from collection app_users' },
            { label: 'Update validator on app_users (removed: name)' },
          ],
        },
      },
    });
    expect(result.ok ? result.value.plan.operations : result).toHaveLength(3);
  });

  it('follows the route of a collection swap refusal through two runs', async () => {
    const stage = (seed: string, user: string, account: string) =>
      fixtureContract(
        seed,
        {
          User: { collection: user, fields: ['_id', 'name'] },
          Account: { collection: account, fields: ['_id', 'name'] },
        },
        { [user]: {}, [account]: {} },
      );
    const run = async (
      from: ReturnType<typeof stage>,
      to: ReturnType<typeof stage>,
      live: readonly string[],
    ) => {
      const dir = await mkdtemp(join(tmpdir(), 'mongo-db-update-statements-'));
      tempDirs.push(dir);
      const migrationsDir = join(dir, 'migrations');
      await writeContractSnapshot(migrationsDir, from.storage.storageHash, {
        contractJson: from,
        contractDts: '',
      });
      const result = await executeDbUpdate({
        invocation: TEST_INVOCATION,
        answerQuestions: async () => {
          throw new Error('no question is asked');
        },
        driver: {
          close: async () => {},
          databaseName: async () => 'appdb',
        } as unknown as ControlDriverInstance<'mongo', 'mongo'>,
        adapter: {} as unknown as ControlAdapterInstance<'mongo', 'mongo'>,
        familyInstance: {
          ...family,
          readAllMarkers: async () =>
            new Map([['app', { ...marker, storageHash: from.storage.storageHash }]]),
          introspect: async () =>
            new MongoSchemaIR(
              live.map((name) => schemaCollection(name)),
              { fromDatabase: false },
            ),
        } as unknown as ControlFamilyInstance<'mongo', unknown>,
        contract: to,
        mode: 'plan',
        migrations: mongoTargetDescriptor.migrations as unknown as TargetMigrationsCapability<
          'mongo',
          'mongo',
          ControlFamilyInstance<'mongo', unknown>
        >,
        frameworkComponents: [],
        migrationsDir,
        targetId: 'mongo',
        statements: [],
      });
      return result.ok ? result.value.plan.operations.map(({ label }) => label) : result.failure;
    };
    const origin = stage('s0', 'users', 'accounts');
    const through = stage('s1', 'prisma_swap_accounts', 'prisma_swap_users');
    const swapped = stage('s2', 'accounts', 'users');
    expect([
      await run(origin, through, ['users', 'accounts']),
      await run(through, swapped, ['prisma_swap_accounts', 'prisma_swap_users']),
    ]).toEqual([
      [
        'Rename collection accounts to prisma_swap_users',
        'Rename collection users to prisma_swap_accounts',
      ],
      [
        'Rename collection prisma_swap_users to users',
        'Rename collection prisma_swap_accounts to accounts',
      ],
    ]);
  });
});
