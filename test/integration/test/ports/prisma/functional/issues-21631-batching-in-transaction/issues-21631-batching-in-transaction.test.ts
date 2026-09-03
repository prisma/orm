import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/21631-batching-in-transaction
// (postgres matrix entry; allProviders — this is the postgres port).
//
// Subject: batching / query compacting must not mix up result sets. One Worker is
// seeded (email + phone, both @unique). Two findUniques run — one by the existing
// email (hit) and one by a non-existing phone (miss → null) — and each must keep its
// own result.
//
// Dispositions (per upstream test):
//   - '2 independent findUniques' → PORTED: sequential `.first({email})` / `.first({phone})`.
//   - '2 concurrent findUniques'  → PORTED: the auto-batching-relevant case — two
//     concurrent `.first(...)` via Promise.all; result sets must not interfere.
//   - '2 findUniques in a $transaction' → NON-PORTED: array/batch `$transaction([...])` is
//     absent; prisma-next only has the interactive `transaction(cb)` facade, a different
//     execution path that does not exercise the batch request pipeline this regression depends on.

async function setupData(
  db: Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db'],
) {
  // Upstream deletes all Workers first because it reuses a shared database; here
  // each `withPostgresPort` runs against a fresh DB, so the seed is a clean insert.
  const email = 'test@prisma.io';
  const phone = '+39 123';
  await db.public.Worker.create({ email, phone });
  return { email, phone };
}

describe('ports/prisma/functional/issues-21631-batching-in-transaction', () => {
  it(
    '2 independent findUniques',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const { email, phone } = await setupData(db);
        const notExistingPhone = `${phone}456`;

        const workerFromEmail = await db.public.Worker.first({ email });
        const workerFromPhone = await db.public.Worker.first({ phone: notExistingPhone });

        expect(workerFromEmail).toMatchObject({ email, phone });
        expect(workerFromPhone).toEqual(null);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    '2 concurrent findUniques',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const { email, phone } = await setupData(db);
        const notExistingPhone = `${phone}456`;

        const [workerFromEmail, workerFromPhone] = await Promise.all([
          db.public.Worker.first({ email }),
          db.public.Worker.first({ phone: notExistingPhone }),
        ]);

        expect(workerFromEmail).toMatchObject({ email, phone });
        expect(workerFromPhone).toEqual(null);
      }),
    timeouts.spinUpPpgDev,
  );
});
