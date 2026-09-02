import mongoAdapterControl from '@internal/adapter-mongo/control';
import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import { createMongoDriver } from '@internal/driver-mongo';
import mongoDriverControl from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { MongoContractSerializer } from '@internal/family-mongo/ir';
import {
  APP_SPACE_ID,
  createControlStack,
  type MigrationOperationPolicy,
} from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type {
  AnyMongoTypeMaps,
  MongoContract,
  MongoContractWithTypeMaps,
} from '@internal/mongo-contract';
import type { MongoOrmClient } from '@internal/mongo-orm';
import { mongoOrm } from '@internal/mongo-orm';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
} from '@internal/mongo-runtime';
import { mongoTargetDescriptor as mongoTargetControl } from '@internal/target-mongo/control';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';

export interface MongoPortContext<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
> {
  /** mongoOrm handle: `db.<root>...` */
  readonly db: MongoOrmClient<TContract>;
  /** Raw MongoClient for seeding / inspection. */
  readonly client: MongoClient;
  /** The `dbName` database, obtained from `client`. */
  readonly mongoDb: Db;
  readonly contract: TContract;
}

export interface WithMongoPortOptions {
  /** The emitted `contract.json` (imported with `{ type: 'json' }`). */
  readonly contractJson: unknown;
  /** Database name to use (defaults to `'test'`). */
  readonly dbName?: string;
}

/**
 * Generic MongoDB harness for ported tests.
 *
 * Each ported suite authors its schema as PSL (`_fixtures/<suite>/contract.prisma`)
 * and emits a `contract.json` / `contract.d.ts`. The harness:
 *   1. starts a `MongoMemoryReplSet` (wiredTiger, single-node),
 *   2. pushes the emitted contract through Prisma Next's plan → apply path,
 *   3. connects a `MongoClient` (raw) + a prisma-next `MongoRuntime`,
 *   4. deserialises the emitted `contract.json` and builds a `mongoOrm` handle,
 *   5. yields `{ db, client, mongoDb, contract }`,
 *   6. drops the database + tears down in a `finally` block.
 */

const initPolicy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive'],
};

const controlStack = createControlStack({
  family: mongoFamilyDescriptor,
  target: mongoTargetControl,
  adapter: mongoAdapterControl,
  driver: mongoDriverControl,
  extensions: [],
});
const controlFamily = mongoFamilyDescriptor.create(controlStack);
const controlAdapter = mongoAdapterControl.create(controlStack);
const frameworkComponents = [mongoTargetControl, mongoAdapterControl, mongoDriverControl] as const;

async function pushContract(connectionUri: string, contractJson: unknown): Promise<void> {
  const contract = controlFamily.deserializeContract(contractJson);
  const driver = await mongoDriverControl.create(connectionUri);
  try {
    const schema = await controlFamily.introspect({ driver, contract });
    const planner = mongoTargetControl.migrations.createPlanner(controlAdapter);
    const planResult = planner.plan({
      contract,
      schema,
      policy: initPolicy,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`Contract push planning failed: ${JSON.stringify(planResult)}`);
    }

    const plan = planResult.plan;
    const runner = mongoTargetControl.migrations.createRunner(controlFamily);
    const executeResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: plan.spaceId ?? APP_SPACE_ID,
          plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: plan.origin?.storageHash,
              destinationStorageHash: plan.destination.storageHash,
              operationCount: plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: initPolicy,
          frameworkComponents,
        },
      ],
    });
    if (!executeResult.ok) {
      throw new Error(`Contract push apply failed: ${JSON.stringify(executeResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

export async function withMongoPort<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
>(
  options: WithMongoPortOptions,
  fn: (ctx: MongoPortContext<TContract>) => Promise<void>,
): Promise<void> {
  const dbName = options.dbName ?? 'test';
  const contract = new MongoContractSerializer().deserializeContract(
    JSON.parse(JSON.stringify(options.contractJson)),
  ) as TContract;

  let replSet: MongoMemoryReplSet | undefined;
  let client: MongoClient | undefined;

  try {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    const connectionUri = replSet.getUri(dbName);
    await pushContract(connectionUri, options.contractJson);
    client = new MongoClient(connectionUri);
    await client.connect();

    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract, stack });
    const driver = await createMongoDriver(connectionUri, dbName);
    const runtime = createMongoRuntime({ context, driver });

    try {
      const db = mongoOrm<TContract>({ contract, executor: runtime });
      const mongoDb = client.db(dbName);
      await fn({ db, client, mongoDb, contract });
    } finally {
      await runtime.close();
    }
  } finally {
    await client?.close();
    await replSet?.stop();
  }
}

export { timeouts };
