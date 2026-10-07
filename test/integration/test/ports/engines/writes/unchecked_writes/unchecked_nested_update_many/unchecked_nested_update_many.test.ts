import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as CompoundKeysContract } from './_fixture/schema_1/generated/contract';
import compoundKeysJson from './_fixture/schema_1/generated/contract.json' with { type: 'json' };
import type { Contract as ParentKeyContract } from './_fixture/schema_2/generated/contract';
import parentKeyJson from './_fixture/schema_2/generated/contract.json' with { type: 'json' };
import type { Contract as AutoincrementContract } from './_fixture/schema_3/generated/contract';
import autoincrementJson from './_fixture/schema_3/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/unchecked_writes/unchecked_nested_update_many', () => {
  it(
    'nested updateMany writes the foreign keys of another relation, including null (allow_write_non_prent_inline_rel_sclrs)',
    () =>
      withPostgresPort<CompoundKeysContract>({ contractJson: compoundKeysJson }, async ({ db }) => {
        await db.public.ModelB.create({
          id: 1,
          uniq_1: 'b1_1',
          uniq_2: 'b1_2',
          a: (a) =>
            a.create([
              { id: 1, c: (c) => c.create({ id: 1, uniq_1: 'c1_1', uniq_2: 'c1_2' }) },
              { id: 2, c: (c) => c.create({ id: 2, uniq_1: 'c2_1', uniq_2: 'c2_2' }) },
            ]),
        });
        await db.public.ModelC.create({ id: 3, uniq_1: 'c3_1', uniq_2: 'c3_2' });

        const connected = await db.public.ModelB.where({ uniq_1: 'b1_1', uniq_2: 'b1_2' })
          .select('id')
          .include('a', (a) =>
            a
              .select('id')
              .orderBy((row) => row.id.asc())
              .include('c', (c) => c.select('uniq_1', 'uniq_2')),
          )
          .update({
            a: (a) => a.where((row) => row.id.neq(0)).updateAll({ c_id_1: 'c3_1', c_id_2: 'c3_2' }),
          });

        expect(connected).toEqual({
          id: 1,
          a: [
            { id: 1, c: { uniq_1: 'c3_1', uniq_2: 'c3_2' } },
            { id: 2, c: { uniq_1: 'c3_1', uniq_2: 'c3_2' } },
          ],
        });

        const cleared = await db.public.ModelB.where({ uniq_1: 'b1_1', uniq_2: 'b1_2' })
          .select('id')
          .include('a', (a) =>
            a
              .select('id')
              .orderBy((row) => row.id.asc())
              .include('c', (c) => c.select('uniq_1', 'uniq_2')),
          )
          .update({
            a: (a) => a.where((row) => row.id.neq(0)).updateAll({ c_id_1: null }),
          });

        expect(cleared).toEqual({
          id: 1,
          a: [
            { id: 1, c: null },
            { id: 2, c: null },
          ],
        });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested updateMany is refused when it sets the foreign key to the parent (disallow_write_parent_inline_rel_sclrs)',
    () =>
      withPostgresPort<ParentKeyContract>({ contractJson: parentKeyJson }, async ({ db }) => {
        await expect(
          db.public.ModelB.where({ id: 1 })
            .select('id')
            .update({
              // @ts-expect-error
              a: (a) => a.where({ id: 1 }).updateAll({ b_id: 123 }),
            }),
        ).rejects.toMatchObject({ code: 'ORM.RELATION_MUTATION_INVALID' });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'nested updateMany writes an autoincrement id (allow_write_autoinc_id)',
    () =>
      withPostgresPort<AutoincrementContract>(
        { contractJson: autoincrementJson },
        async ({ db }) => {
          await db.public.ModelA.select('id').create({ b: (b) => b.create({ id: 1 }) });

          const updated = await db.public.ModelB.where({ id: 1 })
            .select('id')
            .include('a', (a) => a.select('id'))
            .update({
              a: (a) => a.where((row) => row.id.neq(0)).updateAll({ id: 111 }),
            });

          expect(updated).toEqual({ id: 1, a: [{ id: 111 }] });
        },
      ),
    timeouts.spinUpPpgDev,
  );
});
