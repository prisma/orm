import { createMigrationPlan, type SqlMigrationPlanOperation } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { verifyMigrationHash } from '@internal/migration-tools/hash';
import { readMigrationPackage } from '@internal/migration-tools/io';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { join } from 'pathe';
import { describe, expect, it } from 'vitest';

const migrationsDir = join(import.meta.dirname, '../../../../../3-extensions/pgvector/migrations');

describe('an ops.json written before checks carried an expectation', () => {
  it('reads, keeps its hash, and plans its checks without one', async () => {
    const pkg = await readMigrationPackage(
      join(migrationsDir, '20260601T0000_install_vector_extension'),
      { migrationsDir },
    );
    const plan = createMigrationPlan<PostgresPlanTargetDetails>({
      targetId: 'postgres',
      spaceId: APP_SPACE_ID,
      origin: null,
      destination: { storageHash: pkg.metadata.to },
      operations: pkg.ops as readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[],
      providedInvariants: [],
    });
    const [operation] =
      plan.operations as readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[];

    expect({
      verified: verifyMigrationHash(pkg).ok,
      precheck: operation?.precheck.map((step) => step.expectation),
      postcheck: operation?.postcheck.map((step) => step.expectation),
    }).toEqual({ verified: true, precheck: [undefined], postcheck: [undefined] });
  });
});
