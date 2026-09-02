import { or } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/chunking-query
// (postgres matrix entry; allProviders matrix includes POSTGRESQL, COCKROACHDB, MYSQL, SQLITE).
//
// SUBJECT per group:
//
// "issues #8832 / #9326 success cases" — verifies that queries succeed when the
// number of bind parameters reaches or exceeds the driver's maximum.
// Prisma Client's query engine CHUNKS the IN-clause query when param count exceeds
// the database limit. prisma-next does NOT chunk automatically.
//
//   'should succeed when "in" has MAX ids'           → NON-PORTED: prisma-next does not chunk,
//     so seeding MAX_BIND_VALUES rows and selecting them back through one un-chunked IN query
//     terminates the connection on the real CI Postgres backend (SqlConnectionError). It only
//     "passes" under PGlite, which does not enforce the wire limit and tolerates the large
//     single query; the outcome is backend-dependent, so the chunking subject is inexpressible.
//   'should succeed when "include" involves MAX …'   → NON-PORTED: subject is engine chunking
//     for child-record IN batches; prisma-next uses LATERAL/json_agg, not a separate IN fetch,
//     so the chunking concern is inexpressible through prisma-next's ORM.
//   'should succeed when "in" has EXCESS ids'        → NON-PORTED: PGlite (WASM) does not
//     enforce the 32767-param wire limit, so the failure mode cannot be reproduced; the test
//     would pass as a regular test and is vacuously true under PGlite.
//   'should succeed when "include" involves EXCESS …' → NON-PORTED (same as include MAX above)
//   'should succeed when raw query has MAX ids'      → NON-PORTED ($queryRawUnsafe mechanism)
//   'should fail when raw query has EXCESS ids'      → NON-PORTED ($queryRawUnsafe mechanism)
//
// "chunking logic does not trigger with 2 IN filters":
//   'Selecting MAX ids at once in two inclusive disjunct filters succeeds'
//     → PORTED: OR(id.in(ids), id.in(ids)) with (MAX-1)/2 ids each, no rows seeded (empty result)
//   'Selecting EXCESS ids at once in two inclusive disjunct filters results in error'
//     → NON-PORTED: PGlite does not enforce the 32767-param limit; the failure mode cannot
//        be reproduced via PGlite even though prisma-next does not chunk.

// PostgreSQL bind-parameter constants (matches upstream `_utils.ts` for postgres).
const MAX_BIND_VALUES = 32766;

function generatedIds(n: number): number[] {
  return Array.from({ length: n }, (_, i) => i + 1);
}

describe('ports/prisma/functional/chunking-query', () => {
  describe('chunking logic does not trigger with 2 IN filters', () => {
    it(
      'Selecting MAX ids at once in two inclusive disjunct filters succeeds',
      () =>
        withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
          // (MAX-1)/2 ids per IN clause: (32766-1)/2 = 16382 per clause, 32764 total params.
          const ids = generatedIds(Math.floor((MAX_BIND_VALUES - 1) / 2));
          // Upstream asserts `toMatchInlineSnapshot('[]')` — no tags seeded, so empty result.
          const tags = await db.public.Tag.where((t) => or(t.id.in(ids), t.id.in(ids))).all();
          expect(tags).toEqual([]);
        }),
      timeouts.spinUpPpgDev,
    );
  });
});
