import { describe, expect, expectTypeOf, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

type Plan = 'FREE' | 'PAID' | 'CUSTOM';

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/enum-array
// (postgres matrix entry; sqlserver/mysql/sqlite opted-out upstream).
//
// A text-backed enum list column (`Plan[]` with `@@type("pg/text@1")`) used to
// emit `CHECK (plans IN (...))`, which Postgres rejects for an array column, so
// the contract push failed before any ORM operation ran. The membership check
// is now array containment, and the suite passes.
//
// The third upstream test ("can retrieve data with an enum array with a raw
// query and a custom parser") uses a driver-adapter-specific raw query path
// with a custom OID parser — not expressible through the prisma-next ORM public
// API — non-ported (see ledger).

function withEnumArray(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, fn);
}

describe('ports/prisma/functional/enum-array', () => {
  it(
    'can create data with an enum array',
    () =>
      withEnumArray(async ({ db }) => {
        const user = await db.public.User.create({ plans: ['FREE'] });
        expect(user.id).toBeDefined();
        expect(user.plans).toEqual(['FREE']);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'can retrieve data with an enum array',
    () =>
      withEnumArray(async ({ db }) => {
        const created = await db.public.User.create({ plans: ['FREE'] });

        const found = await db.public.User.first({ id: created.id });

        expect(found).not.toBeNull();
        expect(found!.plans).toEqual(['FREE']);
        expectTypeOf(found!.plans).toEqualTypeOf<ReadonlyArray<Plan>>();
      }),
    timeouts.spinUpPpgDev,
  );
});
