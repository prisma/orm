import type { MongoControlFamilyInstance } from '@internal/family-mongo/control';
import type { MongoRunnerDependencies } from '@internal/family-mongo/control-adapter';
import type {
  MigrationPlan,
  MigrationRunnerPerSpaceOptions,
} from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import { mongoTargetDescriptor } from '../src/core/migrations/control-target';
import { createCollection } from '../src/core/migrations/migration-factories';
import { serializeMongoOps } from '../src/core/migrations/mongo-ops-serializer';

/** Dependencies with no members: the runner refuses the plan before it calls any. */
const noDependencies = {} as MongoRunnerDependencies;

const family = {
  createRunnerDependencies: () => noDependencies,
} as unknown as MongoControlFamilyInstance;

const plan: MigrationPlan = {
  targetId: 'mongo',
  spaceId: 'audit',
  destination: { storageHash: 'dest' },
  operations: JSON.parse(serializeMongoOps([createCollection('orders')])),
};

describe('the Mongo target runner across spaces', () => {
  it('attributes a failure to the space whose plan failed, keeping its code and message', async () => {
    const runner = mongoTargetDescriptor.migrations.createRunner(family);
    const perSpace = {
      space: 'audit',
      plan,
      driver: {},
      destinationContract: {},
      policy: { allowedOperationClasses: ['widening'] },
      frameworkComponents: [],
      migrationEdges: [],
    } as unknown as MigrationRunnerPerSpaceOptions<'mongo', 'mongo'>;

    const result = await runner.execute({
      driver: {} as never,
      perSpaceOptions: [perSpace],
    });

    const failure = result.assertNotOk();
    expect({
      code: failure.code,
      message: failure.message,
      failingSpace: failure.meta.failingSpace,
      databaseUnchanged: failure.meta.databaseUnchanged,
    }).toEqual({
      code: 'MIGRATION.POLICY_VIOLATION',
      message:
        'Operation collection.orders.create has class "additive" which is not allowed by policy.',
      failingSpace: 'audit',
      databaseUnchanged: true,
    });
  });
});
