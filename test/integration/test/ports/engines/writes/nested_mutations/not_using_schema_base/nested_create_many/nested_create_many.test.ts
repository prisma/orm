import { UNIQUE_VIOLATION_SQLSTATE } from '@internal/sql-errors';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

describe('ports/engines/writes/nested_mutations/not_using_schema_base/nested_create_many', () => {
  it(
    'a nested createMany in a top-level create creates every row (create_many_on_create)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.public.ModelA.select('id')
          .include('bs', (bs) => bs.select('id').orderBy((b) => b.id.asc()))
          .create({
            id: 1,
            bs: (bs) =>
              bs.create([
                { id: 1, str1: '1', str2: '1', str3: '1' },
                { id: 2, str1: '2', str3: null },
                { id: 3, str1: '1' },
              ]),
          });

        expect(created.bs).toEqual([{ id: 1 }, { id: 2 }, { id: 3 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested createMany with one row instead of a list creates it (create_many_shorthand_on_create)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.public.ModelA.select('id')
          .include('bs', (bs) => bs.select('id'))
          .create({
            id: 1,
            bs: (bs) => bs.create({ id: 1, str1: '1', str2: '1', str3: '1' }),
          });

        expect(created.bs).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested createMany fails on duplicate rows by default (nested_createmany_fail_dups)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await expect(
          db.public.ModelA.select('id')
            .include('bs', (bs) => bs.select('id'))
            .create({
              id: 1,
              bs: (bs) =>
                bs.create([
                  { id: 1, str1: '1', str2: '1', str3: '1' },
                  { id: 1, str1: '2', str3: null },
                ]),
            }),
        ).rejects.toMatchObject({ sqlState: UNIQUE_VIOLATION_SQLSTATE });
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested createMany that skips duplicates creates the first row of each key (no_error_on_dups_when_skip_dups)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const created = await db.public.ModelA.select('id')
          .include('bs', (bs) => bs.select('id'))
          .create({
            id: 1,
            bs: (bs) =>
              bs.create(
                [
                  { id: 1, str1: '1', str2: '1', str3: '1' },
                  { id: 1, str1: '2', str3: null },
                ],
                { onConflict: 'skip' },
              ),
          });

        expect(created.bs).toEqual([{ id: 1 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'a nested createMany creates a large number of rows (allow_create_large_number_records)',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        const records = Array.from({ length: 1000 }, (_, index) => ({
          id: index + 1,
          str1: String(index + 1),
        }));

        await db.public.ModelA.select('id').create({ id: 1, bs: (bs) => bs.create(records) });

        expect(
          await db.public.ModelB.aggregate((aggregate) => ({ all: aggregate.count() })),
        ).toEqual({
          all: 1000,
        });
      }),
    timeouts.spinUpPpgDev,
  );
});
