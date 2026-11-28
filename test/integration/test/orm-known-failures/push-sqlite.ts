import sqliteAdapterControl from '@internal/adapter-sqlite/control';
import type { Contract } from '@internal/contract/types';
import sqliteDriverControl from '@internal/driver-sqlite/control';
import sqlFamilyControl, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import sqliteTargetControl from '@internal/target-sqlite/control';

const stack = createControlStack({
  family: sqlFamilyControl,
  target: sqliteTargetControl,
  adapter: sqliteAdapterControl,
  driver: sqliteDriverControl,
  extensions: [],
});
const controlFamily = sqlFamilyControl.create(stack);
const frameworkComponents = [sqliteTargetControl, sqliteAdapterControl] as const;

export async function pushContract(path: string, contractJson: unknown): Promise<void> {
  const contract = controlFamily.deserializeContract(contractJson) as Contract<SqlStorage>;
  const driver = await sqliteDriverControl.create(path);
  try {
    const planned = sqliteTargetControl.createPlanner(sqliteAdapterControl.create(stack)).plan({
      contract,
      schema: await controlFamily.introspect({ driver }),
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      origin: null,
      statements: [],
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planned.kind !== 'success') {
      throw new Error(`Contract push planning failed: ${JSON.stringify(planned)}`);
    }
    const applied = await sqliteTargetControl.createRunner(controlFamily).execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planned.plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: planned.plan.origin?.storageHash,
              destinationStorageHash: planned.plan.destination.storageHash,
              operationCount: planned.plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!applied.ok) {
      throw new Error(`Contract push apply failed: ${JSON.stringify(applied.failure)}`);
    }
  } finally {
    await driver.close();
  }
}
