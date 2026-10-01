/**
 * An included relation carries each related row as JSON the database builds, and the ORM reads each
 * value of it back with the column's codec. A list column may hold NULL elements, and a nullable list
 * column may be NULL; both must come back as they are stored.
 */
import postgresAdapter from '@internal/adapter-postgres/control';
import postgresRuntimeAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import { orm } from '@internal/sql-orm-client';
import { createExecutionContext, createSqlExecutionStack } from '@internal/sql-runtime';
import postgres from '@internal/target-postgres/control';
import postgresRuntimeTarget from '@internal/target-postgres/runtime';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRuntimeFromClient } from '../utils';
import { authorSqlContractFromPsl, postgresFrameworkComponents } from './psl-list-authoring';

const schema = `model Owner {
  id    Int    @id
  items Item[]

  @@map("owner")
}

model Item {
  id      Int       @id
  ownerId Int
  owner   Owner     @relation(fields: [ownerId], references: [id])
  tags    String[]  @noCheck(elementNotNull)
  scores  Int[]     @noCheck(elementNotNull)
  labels  String[]? @noCheck(elementNotNull)

  @@map("item")
}
`;

interface ItemsQuery {
  select(...fields: readonly string[]): ItemsQuery;
  orderBy(order: (item: { readonly id: { asc(): unknown } }) => unknown): ItemsQuery;
}

interface OwnerCollection {
  include(
    relation: 'items',
    refine: (items: ItemsQuery) => ItemsQuery,
  ): { all(): Promise<readonly unknown[]> };
}

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensions: [],
});
const familyInstance = sql.create(controlStack);

async function migrateContract(connectionString: string, contract: Contract<SqlStorage>) {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const planResult = postgres.createPlanner(postgresAdapter.create(controlStack)).plan({
      contract,
      schema: await familyInstance.introspect({ driver }),
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: postgresFrameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
    }
    const runResult = await postgres.createRunner(familyInstance).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: planResult.plan.origin?.storageHash,
              destinationStorageHash: planResult.plan.destination.storageHash,
              operationCount: planResult.plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: postgresFrameworkComponents,
        },
      ],
    });
    if (!runResult.ok) {
      throw new Error(`runner failed: ${JSON.stringify(runResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

describe('an included relation with list columns', { concurrent: false }, () => {
  let database: DevDatabase | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'reads back NULL list elements and a NULL list as they are stored',
    async () => {
      if (!database) throw new Error('database not initialised');
      const authored = await authorSqlContractFromPsl(schema);
      if (authored.contract === undefined) {
        throw new Error(`the PSL did not load: ${JSON.stringify(authored.diagnostics)}`);
      }
      const contract = authored.contract;
      await migrateContract(database.connectionString, contract);

      await withClient(database.connectionString, async (client) => {
        await client.query('INSERT INTO "owner" ("id") VALUES (1)');
        await client.query(
          `INSERT INTO "item" ("id", "ownerId", "tags", "scores", "labels") VALUES
            (10, 1, ARRAY['a', NULL]::text[], ARRAY[1, NULL]::int4[], NULL),
            (11, 1, ARRAY[]::text[], ARRAY[]::int4[], ARRAY['x', NULL]::text[])`,
        );

        const runtime = await createTestRuntimeFromClient(contract, client, {
          verifyMarker: false,
        });
        const context = createExecutionContext({
          contract,
          stack: createSqlExecutionStack({
            target: postgresRuntimeTarget,
            adapter: postgresRuntimeAdapter,
            extensions: [],
          }),
        });
        // The contract is authored at test time, so the ORM is not typed by an emitted contract; this names the part of it the test uses.
        const db = orm({ runtime, context }) as unknown as {
          readonly public: { readonly Owner: OwnerCollection };
        };

        const owners = await db.public.Owner.include('items', (items) =>
          items.select('id', 'tags', 'scores', 'labels').orderBy((item) => item.id.asc()),
        ).all();

        expect(owners).toEqual([
          {
            id: 1,
            items: [
              { id: 10, tags: ['a', null], scores: [1, null], labels: null },
              { id: 11, tags: [], scores: [], labels: ['x', null] },
            ],
          },
        ]);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
