import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/large-floats
// (postgres matrix entry).
//
// Upstream seeds five Floats rows with large/extreme float values and asserts
// each round-trips exactly. The upstream note about js_pg float precision says
// Postgres < 12 may be affected; PGlite (which prisma-next's integration tests
// use) uses a modern libpq under the hood and the issue is not present.
//
// API translation: `prisma.floats.create({ data: { value } })` → `db.public.Floats.create({ id, value })`
// (id is String @id; we supply deterministic ids for seeding).

describe('ports/prisma/functional/large-floats', () => {
  it(
    'floats',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const largeFloat = await db.public.Floats.create({ id: '1', value: 1e20 });
        const negativeFloat = await db.public.Floats.create({ id: '2', value: -1e20 });
        const largeInteger = await db.public.Floats.create({
          id: '3',
          value: Number.MAX_SAFE_INTEGER,
        });
        const negativeInteger = await db.public.Floats.create({
          id: '4',
          value: Number.MIN_SAFE_INTEGER,
        });
        const otherFloat = await db.public.Floats.create({ id: '5', value: 13.37 });

        expect(largeFloat.value).toEqual(1e20);
        expect(negativeFloat.value).toEqual(-1e20);
        expect(largeInteger.value).toEqual(Number.MAX_SAFE_INTEGER);
        expect(negativeInteger.value).toEqual(Number.MIN_SAFE_INTEGER);
        expect(otherFloat.value).toEqual(13.37);
      }),
    timeouts.spinUpPpgDev,
  );
});
