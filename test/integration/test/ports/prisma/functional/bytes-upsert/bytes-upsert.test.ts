import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/bytes-upsert
// (postgres matrix entry; sqlserver opted out — does not support bytes IDs).
//
// Regression test for v7 bug: "No record was found for an upsert" when calling
// upsert twice with the same Bytes @unique value.
//
// In prisma-next, the Bytes field is typed as Uint8Array and `conflictOn` is
// used instead of Prisma's `where: { bytes: byteId }`.
//
describe('ports/prisma/functional/bytes-upsert', () => {
  it(
    'bytes upsert works correctly',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const byteId = new Uint8Array(randomBytes(16));

        const upsertByteRow = () =>
          db.public.TestByteId.upsert({
            create: { bytes: byteId },
            update: {},
            conflictOn: { bytes: byteId },
          });

        await upsertByteRow();
        await upsertByteRow();

        const result = await db.public.TestByteId.select('bytes').first({ bytes: byteId });
        expect(result).toEqual({ bytes: byteId });
      }),
    timeouts.spinUpPpgDev,
  );
});
