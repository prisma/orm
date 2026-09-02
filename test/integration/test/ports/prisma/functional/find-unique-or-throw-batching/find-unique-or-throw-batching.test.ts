import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/find-unique-or-throw-batching
// (postgres matrix entry; allProviders — this is the postgres port).
//
// Subject per test:
//   'batched errors are when all objects in batch are found'
//     → concurrent findUniqueOrThrow on existing rows: all Promise.allSettled entries fulfilled.
//   'batched errors when some of the objects not found'
//     → concurrent findUniqueOrThrow with a missing row: that slot rejects with P2025
//       (prisma-next: RUNTIME.NO_ROWS).
//
// Upstream uses Promise.allSettled([findUniqueOrThrow, findUniqueOrThrow]).
// prisma-next: findUniqueOrThrow({ where: { id } }) → .where({ id }).all().firstOrThrow()
// Missing-row error surfaces as code 'RUNTIME.NO_ROWS' (maps to Prisma P2025).
//
// Dispositions:
//   'batched errors are when all objects in batch are found' → PORTED
//   'batched errors when some of the objects not found'      → PORTED

function withFindUniqueOrThrowBatching(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/find-unique-or-throw-batching', () => {
  it(
    'batched errors are when all objects in batch are found',
    () =>
      withFindUniqueOrThrowBatching(async ({ db }) => {
        const row1 = await db.public.User.create({ id: 'id1-aaaaaaaaa' });
        const row2 = await db.public.User.create({ id: 'id2-bbbbbbbbb' });
        const id1 = row1.id;
        const id2 = row2.id;

        const found = db.public.User.where({ id: id1 }).all().firstOrThrow();
        const foundToo = db.public.User.where({ id: id2 }).all().firstOrThrow();
        const result = await Promise.allSettled([found, foundToo]);

        expect(result).toEqual([
          { status: 'fulfilled', value: { id: id1 } },
          { status: 'fulfilled', value: { id: id2 } },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'batched errors when some of the objects not found',
    () =>
      withFindUniqueOrThrowBatching(async ({ db }) => {
        const row1 = await db.public.User.create({ id: 'id1-aaaaaaaaa' });
        const id1 = row1.id;
        const missing = 'missing-aaaaaaaaaa';

        const found = db.public.User.where({ id: id1 }).all().firstOrThrow();
        const notFound = db.public.User.where({ id: missing }).all().firstOrThrow();
        const newResult = await Promise.allSettled([found, notFound]);

        expect(newResult).toEqual([
          { status: 'fulfilled', value: { id: id1 } },
          { status: 'rejected', reason: expect.objectContaining({ code: 'RUNTIME.NO_ROWS' }) },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
