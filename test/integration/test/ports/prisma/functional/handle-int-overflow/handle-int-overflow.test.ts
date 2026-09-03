import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/handle-int-overflow
// (postgres matrix entry).
//
// Upstream asserts that creating an Entry with an out-of-range Int rejects with
// a Prisma client-side message:
//   /Unable to fit value 100000000000000000000 into a 64-bit signed integer for field `int`/
//
// Prisma performs client-side integer range validation before sending the query.
// Prisma-next has no client-side int range validation; the pg driver passes the
// value to PostgreSQL which rejects it with a server-side error:
//   "value ... is out of range for type integer" / "invalid input syntax for type integer"
//
// The subject of the test is "out-of-range Int on create is rejected". Prisma-next
// faithfully exercises that subject — the create rejects — even though the error
// message text differs (server-side vs client-side). We assert .rejects.toThrow()
// without matching the exact Prisma message text, which is Prisma-client-specific.

function withHandleIntOverflow(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/handle-int-overflow', () => {
  it(
    'integer overflow',
    () =>
      withHandleIntOverflow(async ({ db }) => {
        // Upstream: rejects with Prisma client-side message
        //   /Unable to fit value 100000000000000000000 into a 64-bit signed integer/
        // Prisma-next: rejects with PostgreSQL server-side error
        //   "value "100000000000000000000" is out of range for type integer"
        await expect(db.public.Entry.create({ int: 1e20 })).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'big float in exponent notation',
    () =>
      withHandleIntOverflow(async ({ db }) => {
        // Upstream: rejects with Prisma client-side message
        //   /Unable to fit value [\d\.e\+]+ into a 64-bit signed integer/
        // Prisma-next: rejects with PostgreSQL server-side error
        //   "invalid input syntax for type integer"
        await expect(db.public.Entry.create({ int: Number.MAX_VALUE })).rejects.toThrow();
      }),
    timeouts.spinUpPpgDev,
  );
});
