import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

// Port of prisma/prisma@a6d0155
// packages/client/tests/functional/relationMode-17255-same-actions.
//
// Upstream schema (`prisma/_schema_same_actions.ts`) is a 1:1 + 1:1 graph with
// the SAME referential action applied to both relations. `Main.alice` owns the
// `Main.aliceId` FK; `Bob.main` owns the `Bob.mainId @unique` FK. Upstream runs
// the matrix over [DEFAULT, Cascade, NoAction, Restrict] (SetNull/SetNull
// filtered) x [relationMode=foreignKeys, relationMode=prisma].
//
// Only ONE matrix entry (Cascade / relationMode=foreignKeys) has a portable
// test — the nested-`disconnect` case below. See the ledger for the full
// disposition of the non-ported entries:
//   - relationMode=prisma entries: prisma-next has no client-side
//     referential-action emulation; it relies on DB foreign keys.
//   - the nested-`delete` tests (upstream Tests 1-3): prisma-next's nested
//     update mutators are create/connect/disconnect only — there is no nested
//     `delete` mutator (see relation-mutator.ts), so the nested-delete
//     referential-action behaviour cannot be expressed.
//
// This file ports upstream `onDelete: Cascade` ›
// '[update] main with nested disconnect alice should succeed': updating Main
// '1' with `alice: { disconnect: true }` nulls `Main.aliceId` and performs no
// deletion (bob/alice rows are untouched).

describe('ports/prisma/functional/relation-mode-17255-same-actions', () => {
  it(
    'onDelete: Cascade [update] main with nested disconnect alice should succeed',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        // Upstream `createXItems({ count: 2 })`: two Main rows, each with a
        // nested-created bob + alice sharing the row's id.
        const seedTwoMains = async () => {
          for (const id of ['1', '2']) {
            await db.public.Main.create({
              id,
              alice: (alice) => alice.create({ id }),
              bob: (bob) => bob.create({ id }),
            });
          }
        };
        await seedTwoMains();

        const countBob = () => db.public.Bob.aggregate((agg) => ({ n: agg.count() }));
        const bobCountBefore = await countBob();

        await db.public.Main.where({ id: '1' }).update({
          alice: (alice) => alice.disconnect(),
        });

        const bobCountAfter = await countBob();
        // No deletion should happen.
        expect(bobCountAfter).toEqual(bobCountBefore);

        expect(
          await db.public.Main.select('id', 'aliceId')
            .orderBy((m) => m.id.asc())
            .all(),
        ).toEqual([
          // We expect the disconnect to happen.
          { id: '1', aliceId: null },
          { id: '2', aliceId: '2' },
        ]);
        expect(
          await db.public.Bob.select('id', 'mainId')
            .orderBy((b) => b.id.asc())
            .all(),
        ).toEqual([
          { id: '1', mainId: '1' },
          { id: '2', mainId: '2' },
        ]);
        expect(
          await db.public.Alice.select('id')
            .orderBy((a) => a.id.asc())
            .all(),
        ).toEqual([{ id: '1' }, { id: '2' }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
