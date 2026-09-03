import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/28591-mapped-enums
// (postgres only; optOut excludes all others).
//
// Subject: creating a record with a @map'd enum value works — `SuggestionStatus.PENDING`
// (@map("pending") in Prisma schema) stores 'pending' in the PG enum type but returns
// 'PENDING' (the TypeScript enum name) from the ORM.
//
// In prisma-next, native_enum member values ARE the PG enum labels and the pg/enum@1
// codec returns them verbatim. The faithful schema uses `PENDING = "pending"` so the
// PG type stores 'pending'. When creating with status 'pending' (the only valid PG label),
// the ORM returns 'pending' — not 'PENDING' as the upstream asserts.
//
// Gap: prisma-next does not implement Prisma's @map-on-enum-member semantics (translating
// between TS enum name and DB label). Marked it.fails.

function withIssue28591(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-28591-mapped-enums', () => {
  it.fails(
    'create with mapped enum',
    () =>
      withIssue28591(async ({ db }) => {
        // In prisma-next the valid input value for status is the PG label 'pending',
        // not the TS name 'PENDING'. The pg/enum@1 codec returns the PG label verbatim,
        // so result.status === 'pending', not 'PENDING' — this assertion fails.
        const enrichment = await db.public.SuggestionModel.create({
          suggestedContent: 'some content',
          status: 'pending',
        });

        // Upstream asserts enrichment.status === 'PENDING' (the TS enum name after @map
        // translation). prisma-next returns the PG label 'pending' directly.
        expect(enrichment.status).toBe('PENDING');
      }),
    timeouts.spinUpPpgDev,
  );
});
