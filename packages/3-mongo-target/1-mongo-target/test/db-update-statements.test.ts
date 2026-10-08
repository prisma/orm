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
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { join } from 'pathe';
import { afterEach, describe, expect, it } from 'vitest';
import { mongoTargetDescriptor } from '../src/core/migrations/control-target';

const ORIGIN_HASH = 'a'.repeat(64);
const DESTINATION_HASH = 'b'.repeat(64);

function contractWithModel(storageHash: string, model: string): Contract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    storage: { storageHash, namespaces: {} },
    domain: {
      namespaces: { app: { models: { [model]: { fields: {}, relations: {}, storage: {} } } } },
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
  introspect: async () => new MongoSchemaIR([new MongoSchemaCollection({ name: 'Profile' })]),
  deserializeContract: (json: unknown) => json as Contract,
  toOperationPreview: () => ({ statements: [] }),
} as unknown as ControlFamilyInstance<'mongo', unknown>;

const tempDirs: string[] = [];
afterEach(async () => {
  for (const dir of tempDirs.splice(0)) await rm(dir, { recursive: true, force: true });
});

describe('db update with statements on MongoDB', () => {
  it('fails planning with the statement the Mongo planner refuses', async () => {
    const dir = await mkdtemp(join(tmpdir(), 'mongo-db-update-statements-'));
    tempDirs.push(dir);
    const migrationsDir = join(dir, 'migrations');
    await writeContractSnapshot(migrationsDir, ORIGIN_HASH, {
      contractJson: origin,
      contractDts: '',
    });

    const result = await executeDbUpdate({
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
      ok: false,
      failure: {
        code: 'PLANNING_FAILED',
        conflicts: [
          {
            kind: 'statementRefused',
            summary: expect.stringContaining('MongoDB does not apply rename statements'),
            refusedStatement: {
              kind: 'rename',
              entity: 'model',
              from: { namespaceId: 'app', model: 'Profile' },
              to: { namespaceId: 'app', model: 'User' },
            },
          },
        ],
      },
    });
  });
});
