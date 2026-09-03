import { describe, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/21352-id-does-not-exist
// (postgres + all SQL providers; optOut excludes MongoDB).
//
// Subject: a findMany with a relation-join where-clause must not throw
// "column j1.id does not exist" or "column j1.field does not exist". The regression
// was in the SQL generator selecting the wrong join alias column when the FK column
// name differs from the PK name on the parent table.
//
// Test [1]: Relation1.findMany({ select: { id }, where: { user: { email: X } } })
//   Relation1 has FK `email` → User1.email (parent PK is also named `email`)
//   In prisma-next: where((r) => r.user.some((u) => u.email.eq(X)))
//
// Test [2]: Relation2.findMany({ select: { field }, where: { user: { id: X } } })
//   Relation2 has FK `email` → User2.id (parent PK is named `id`, FK column is `email`)
//   In prisma-next: where((r) => r.user.some((u) => u.id.eq(X)))
//
// Both tests assert the query resolves without error; there are no rows seeded,
// but the generated SQL must not throw "column does not exist".

function withIssue21352(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/issues-21352-id-does-not-exist', () => {
  it(
    '[1] relation-join where on non-id FK column does not fail with column does not exist',
    () =>
      withIssue21352(async ({ db }) => {
        // No rows seeded — the test only verifies the query doesn't throw.
        await db.public.Relation1.select('id')
          .where((r) => r.user.some((u) => u.email.eq('info@example.com')))
          .all();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    '[2] relation-join where on FK column pointing to parent id does not fail with column does not exist',
    () =>
      withIssue21352(async ({ db }) => {
        // No rows seeded — the test only verifies the query doesn't throw.
        await db.public.Relation2.select('field')
          .where((r) => r.user.some((u) => u.id.eq('info@example.com')))
          .all();
      }),
    timeouts.spinUpPpgDev,
  );
});
