#!/usr/bin/env -S node
/**
 * Audit baseline migration — create the `audit_event` table.
 *
 * Hand-edited (see `docs/architecture docs/adrs/
 * ADR 212 - Contract spaces.md`, Path A) so the operation carries the
 * established `audit:create-audit_event-v1` invariantId and matches
 * the original handcrafted SQL byte-for-byte (the planner emits an
 * equivalent op without an invariantId; we preserve invariant identity
 * since invariants cannot be renamed once published).
 *
 * Re-emit `ops.json` / `migration.json` after edits via
 * `node migration.ts` (or `tsx migration.ts` on Node < 24).
 */
import type { SqlMigrationPlanOperation } from '@prisma/orm-postgres/family/control';
import { Migration, MigrationCLI, rawSql } from '@prisma/orm-postgres/target/migration';
import type { PostgresPlanTargetDetails } from '@prisma/orm-postgres/target/planner-target-details';
import { AUDIT_BASELINE_INVARIANT_ID, AUDIT_EVENT_TABLE } from '../../src/constants';
import type { Contract as End } from '../snapshots/d60ebdd877de6283fafbbe0dc9a4fa13c1197009a53ba95ed37ba04fa3640cb1/contract';
import endContract from '../snapshots/d60ebdd877de6283fafbbe0dc9a4fa13c1197009a53ba95ed37ba04fa3640cb1/contract.json' with {
  type: 'json',
};

export default class M extends Migration<never, End> {
  override readonly endContractJson = endContract;

  override get operations(): readonly SqlMigrationPlanOperation<PostgresPlanTargetDetails>[] {
    return [
      rawSql({
        id: `audit.create-${AUDIT_EVENT_TABLE}`,
        label: `Create table "${AUDIT_EVENT_TABLE}"`,
        operationClass: 'additive',
        invariantId: AUDIT_BASELINE_INVARIANT_ID,
        target: {
          id: 'postgres',
          details: { schema: 'public', objectType: 'table', name: AUDIT_EVENT_TABLE },
        },
        precheck: [],
        execute: [
          {
            description: `Create table "${AUDIT_EVENT_TABLE}"`,
            sql: `CREATE TABLE IF NOT EXISTS public."${AUDIT_EVENT_TABLE}" (
        "id" text NOT NULL PRIMARY KEY,
        "actor" text NOT NULL,
        "action" text NOT NULL
      )`,
          },
        ],
        postcheck: [],
      }),
    ];
  }
}

MigrationCLI.run(import.meta.url, M);
