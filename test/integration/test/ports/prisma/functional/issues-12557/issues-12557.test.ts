import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155 packages/client/tests/functional/issues/12557
// (postgres matrix entry; sqlite/mongodb/cockroachdb/sqlserver opted-out upstream).
//
// Verifies that brand counts per category are correct when fetching categories
// with M:N brand counts included. Upstream uses implicit M:N and reads counts
// via `findMany({ include: { _count: { select: { brands: true } } } })`.

describe('ports/prisma/functional/issues-12557', () => {
  it(
    'issue 12557',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        // Faithful nested M:N create: category + brands through the junction
        await db.public.Category.create({
          id: 'cat-1',
          name: 'cat-1',
          brands: (b) =>
            b.create([
              { id: 'brand-1', name: 'brand-1' },
              { id: 'brand-2', name: 'brand-2' },
            ]),
        });

        await db.public.Category.create({
          id: 'cat-2',
          name: 'cat-2',
          brands: (b) =>
            b.create([
              { id: 'brand-3', name: 'brand-3' },
              { id: 'brand-4', name: 'brand-4' },
            ]),
        });

        const categories = await db.public.Category.include('brands', (b) => b.count())
          .select('id', 'name')
          .orderBy((c) => c.name.asc())
          .all();

        expect(categories).toMatchObject([
          { name: 'cat-1', brands: 2 },
          { name: 'cat-2', brands: 2 },
        ]);

        await db.public.Brand.where({ id: 'brand-1' }).delete();

        const categoriesAfter = await db.public.Category.include('brands', (b) => b.count())
          .select('id', 'name')
          .orderBy((c) => c.name.asc())
          .all();

        expect(categoriesAfter).toMatchObject([
          { name: 'cat-1', brands: 1 },
          { name: 'cat-2', brands: 2 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );
});
