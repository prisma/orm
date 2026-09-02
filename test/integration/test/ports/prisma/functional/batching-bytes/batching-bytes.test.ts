import { randomBytes } from 'node:crypto';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/batching-bytes
// (postgres matrix entry; sqlserver opted out — does not support bytes IDs).
//
// Upstream verifies that Prisma Client correctly handles Bytes @unique values in
// concurrent queries. The `$transaction([...])` array-batch form has no prisma-next
// equivalent and remains non-ported.
//
// prisma-next Bytes: typed as Uint8Array for both input and output.
// The faithful `.where({ bytes })` lookup is a direct SELECT WHERE; this is a
// separate code path from the upsert reload gap documented in bytes-upsert.
//
// Dispositions:
//   'findUnique bytes with Promise.all' → PORTED (see it.fails note if gap bites)
//   'findUnique bytes with $transaction([...])' → non-ported (no array-batch surface)
//   'findFirst bytes with Promise.all' → PORTED (see it.fails note if gap bites)
//   'findFirst bytes with $transaction([...])' → non-ported (no array-batch surface)

function withBatchingBytes(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/batching-bytes', () => {
  it(
    'findUnique bytes with Promise.all',
    () =>
      withBatchingBytes(async ({ db }) => {
        const bytes1 = new Uint8Array(randomBytes(16));
        const bytes2 = new Uint8Array(randomBytes(16));

        await db.public.Resource.createAll([
          { id: 'id1', bytes: bytes1 },
          { id: 'id2', bytes: bytes2 },
        ]);

        const [r1, r2] = await Promise.all([
          db.public.Resource.where({ bytes: bytes1 }).select('bytes').all(),
          db.public.Resource.where({ bytes: bytes2 }).select('bytes').all(),
        ]);

        expect([r1[0], r2[0]]).toMatchObject([{ bytes: bytes1 }, { bytes: bytes2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'findFirst bytes with Promise.all',
    () =>
      withBatchingBytes(async ({ db }) => {
        const bytes1 = new Uint8Array(randomBytes(16));
        const bytes2 = new Uint8Array(randomBytes(16));

        await db.public.Resource.createAll([
          { id: 'id1', bytes: bytes1 },
          { id: 'id2', bytes: bytes2 },
        ]);

        const [r1, r2] = await Promise.all([
          db.public.Resource.where({ bytes: bytes1 }).select('bytes').all(),
          db.public.Resource.where({ bytes: bytes2 }).select('bytes').all(),
        ]);

        expect([r1[0], r2[0]]).toMatchObject([{ bytes: bytes1 }, { bytes: bytes2 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
