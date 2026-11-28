#!/usr/bin/env -S node
/**
 * Feature-flags baseline migration — create the `feature_flag` table.
 *
 * Hand-edited (see `docs/architecture docs/adrs/
 * ADR 212 - Contract spaces.md`, Path A) so the operation carries the
 * established `feature-flags:create-feature_flag-v1` invariantId and
 * matches the original handcrafted SQL byte-for-byte.
 *
 * Re-emit `ops.json` / `migration.json` after edits via
 * `node migration.ts` (or `tsx migration.ts` on Node < 24).
 */
import type { SqlMigrationPlanOperation } from '@prisma/orm-postgres/family/control';
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/target/migration';
import type { PostgresPlanTargetDetails } from '@prisma/orm-postgres/target/planner-target-details';
import { FEATURE_FLAG_TABLE, FEATURE_FLAGS_BASELINE_INVARIANT_ID } from '../../src/constants';
import type { Contract as End } from '../snapshots/d3e18b1ba6b92b2a4c94a7565ac9b6f5cb4b3c7ddc9bdcf53b9c55e58526a4c6/contract';
import endContract from '../snapshots/d3e18b1ba6b92b2a4c94a7565ac9b6f5cb4b3c7ddc9bdcf53b9c55e58526a4c6/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations(): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    return [
      rawSql({
        id: `feature-flags.create-${FEATURE_FLAG_TABLE}`,
        label: `Create table "${FEATURE_FLAG_TABLE}"`,
        operationClass: 'additive',
        invariantId: FEATURE_FLAGS_BASELINE_INVARIANT_ID,
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: FEATURE_FLAG_TABLE },
        },
        precheck: [],
        execute: [
          {
            description: `Create table "${FEATURE_FLAG_TABLE}"`,
            sql: `CREATE TABLE IF NOT EXISTS public."${FEATURE_FLAG_TABLE}" (
        "key" text NOT NULL PRIMARY KEY,
        "enabled" boolean NOT NULL
      )`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
