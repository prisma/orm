import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/methods/upsert/simple
// (postgres matrix entry).
//
// Upstream uses `where: { name }` as the conflict key (a @unique field).
// prisma-next upsert() uses `conflictOn: { name }` to specify the unique
// constraint. Count checks use aggregate().

describe('ports/prisma/functional/methods-upsert-simple', () => {
  it(
    'should create a record using upsert',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const name = 'upsert-create-test-user';

        await db.public.User.upsert({
          create: { name },
          update: { name },
          conflictOn: { name },
        });

        const { count } = await db.public.User.where({ name }).aggregate((agg) => ({
          count: agg.count(),
        }));
        expect(count).toEqual(1);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'should update a record using upsert',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const name = 'upsert-update-test-user';

        await db.public.User.create({ name });

        await db.public.User.upsert({
          create: { name },
          update: { name: `${name}new` },
          conflictOn: { name },
        });

        const { countOld } = await db.public.User.where({ name }).aggregate((agg) => ({
          countOld: agg.count(),
        }));
        expect(countOld).toEqual(0);

        const { countNew } = await db.public.User.where({ name: `${name}new` }).aggregate(
          (agg) => ({ countNew: agg.count() }),
        );
        expect(countNew).toEqual(1);
      }),
    timeouts.spinUpPpgDev,
  );
});
