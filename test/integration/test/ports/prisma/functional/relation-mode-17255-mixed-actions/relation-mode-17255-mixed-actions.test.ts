import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/relationMode-17255-mixed-actions
// (postgres matrix entry, relationMode=foreignKeys).
//
// The schema is hardcoded with MIXED referential actions (Main.alice is
// SetNull-on-delete; Bob.main is Cascade-on-delete). The matrix only selects
// WHICH row runs; the schema does not vary. relationMode=foreignKeys relies on
// real database foreign keys, which the harness materialises from the contract.
//
// Upstream `beforeEach` seeds two Main rows, each with a nested-created Bob and
// Alice sharing the same id. prisma-next gives each test a fresh database, so
// the seed runs inside each test.
//
// Only the '[update] ... nested disconnect alice' test is ported. The
// '[update] ... nested delete alice' test uses `alice: { delete: true }`, a
// nested-delete mutator prisma-next's ORM does not expose (create/connect/
// disconnect only) — see the inbox for the non-ported disposition.

async function seedMains(
  db: Parameters<Parameters<typeof withPostgresPort<Contract>>[1]>[0]['db'],
) {
  // Upstream: for id in ['1','2'], main.create({ data: { id, bob:{create:{id}}, alice:{create:{id}} } }).
  for (const id of ['1', '2']) {
    await db.public.Main.create({
      id,
      bob: (b) => b.create({ id }),
      alice: (a) => a.create({ id }),
    });
  }
}

describe('ports/prisma/functional/relation-mode-17255-mixed-actions', () => {
  it(
    '[update] main with nested disconnect alice should succeed',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await seedMains(db);

        const bobCountBefore = await db.public.Bob.aggregate((a) => ({ n: a.count() }));

        // Upstream: main.update({ where:{id:'1'}, data:{ alice:{ disconnect:true } } }).
        await db.public.Main.where({ id: '1' }).update({
          alice: (a) => a.disconnect(),
        });

        const bobCountAfter = await db.public.Bob.aggregate((a) => ({ n: a.count() }));
        // No deletion should happen.
        expect(bobCountAfter.n).toEqual(bobCountBefore.n);

        const mains = await db.public.Main.select('id', 'aliceId')
          .orderBy((m) => m.id.asc())
          .all();
        expect(mains).toEqual([
          // The disconnect nulls Main '1's foreign key.
          { id: '1', aliceId: null },
          { id: '2', aliceId: '2' },
        ]);

        const bobs = await db.public.Bob.select('id', 'mainId')
          .orderBy((b) => b.id.asc())
          .all();
        expect(bobs).toEqual([
          { id: '1', mainId: '1' },
          { id: '2', mainId: '2' },
        ]);

        const alices = await db.public.Alice.select('id')
          .orderBy((a) => a.id.asc())
          .all();
        // No Alice is deleted by a disconnect.
        expect(alices).toEqual([{ id: '1' }, { id: '2' }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
