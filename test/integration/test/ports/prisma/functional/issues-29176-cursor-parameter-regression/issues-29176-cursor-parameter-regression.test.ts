import { randomUUID } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/issues/29176-cursor-parameter-regression
// (postgres matrix entry; allProviders — we port postgres).
//
// Subject: pagination with a cursor whose values are parameterised (connection_uuid
// and query_ref are runtime UUIDs, not literal constants). The cursor sits on a
// composite @@unique([connection_uuid, query_ref, result_index]).
//
// Cursor semantics gap:
//   Prisma cursor is INCLUSIVE (starts FROM the cursor row).
//   prisma-next cursor is EXCLUSIVE (starts AFTER the cursor row).
//
//   Upstream uses: cursor at result_index=1, skip=0, take=5.
//   Prisma result: [{ result_index: 1 }, { result_index: 2 }]  (inclusive, FROM index 1)
//   prisma-next result: [{ result_index: 2 }]                  (exclusive, AFTER index 1)
//
// A faithful port uses `.orderBy().cursor().limit()` — it runs but returns a
// different result → it.fails (genuine prisma-next gap, not a botched port).
//
// Dispositions:
//   'correctly handles a cursor with parameterised values' → it.fails (exclusive vs inclusive cursor)

describe('ports/prisma/functional/issues-29176-cursor-parameter-regression', () => {
  it.fails(
    'correctly handles a cursor with parameterised values',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const connection_uuid = randomUUID();
        const query_ref = 'asdf';

        await db.public.ListResult.createAll([
          { connection_uuid, query_ref, result_index: 0 },
          { connection_uuid, query_ref, result_index: 1 },
          { connection_uuid, query_ref, result_index: 2 },
        ]);

        // Faithful port of upstream's findMany with a composite cursor:
        //   cursor: { connection_uuid_query_ref_result_index: { connection_uuid, query_ref, result_index: 1 } }
        //   skip: 0, take: 5
        // prisma-next cursor: must orderBy the cursor columns first.
        // Prisma expects result_index 1 AND 2 (inclusive cursor, skip=0).
        // prisma-next returns only result_index 2 (exclusive cursor).
        const results = await db.public.ListResult.where({ connection_uuid, query_ref })
          .orderBy((r) => r.result_index.asc())
          .cursor({ result_index: 1 })
          .limit(5)
          .select('result_index')
          .all();

        // Upstream expects inclusive: [{ result_index: 1 }, { result_index: 2 }]
        // prisma-next exclusive cursor returns: [{ result_index: 2 }]
        // This assertion faithfully mirrors upstream and fails due to the semantics gap.
        expect(results).toEqual([{ result_index: 1 }, { result_index: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
