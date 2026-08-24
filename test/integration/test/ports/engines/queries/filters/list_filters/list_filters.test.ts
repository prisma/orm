import { not } from '@internal/sql-orm-client';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../_harness/postgres';
import type { Contract as BaseContract } from './_fixture/base/generated/contract';
import baseContractJson from './_fixture/base/generated/contract.json' with { type: 'json' };
import type {
  Contract as DecimalContract,
  FieldInputTypes as DecimalFieldInputTypes,
} from './_fixture/decimal/generated/contract';
import decimalContractJson from './_fixture/decimal/generated/contract.json' with { type: 'json' };
import type { Contract as JsonContract } from './_fixture/json/generated/contract';
import jsonContractJson from './_fixture/json/generated/contract.json' with { type: 'json' };

type DecimalListInput = DecimalFieldInputTypes['public']['TestModel']['decimal'];

const testBytes = new Uint8Array([116, 101, 115, 116]);
const tBytes = new Uint8Array([116]);
const firstDate = Temporal.Instant.from('1969-01-01T10:33:59.000Z');
const secondDate = Temporal.Instant.from('2018-12-05T12:34:23.000Z');

function withBaseLists(fn: Parameters<typeof withPostgresPort<BaseContract>>[1]) {
  return withPostgresPort<BaseContract>({ contractJson: baseContractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll([
      {
        id: 1,
        string: ['a', 'A', 'c'],
        int: [1, 2, 3],
        float: [1.1, 2.2, 3.3],
        bInt: [100n, 200n, 300n],
        dt: [firstDate, secondDate],
        bool: [true],
        bytes: [testBytes, tBytes],
      },
      { id: 2, string: [], int: [], float: [], bInt: [], dt: [], bool: [], bytes: [] },
    ]);
    await fn(ctx);
  });
}

describe('ports/engines/queries/filters/list_filters', () => {
  it(
    'equality for base scalar lists',
    () =>
      withBaseLists(async ({ db }) => {
        expect(
          await db.public.TestModel.where((row) => row.string.eq(['a', 'A', 'c']))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.string.eq(['a', 'A', 'c'])))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);

        expect(
          await db.public.TestModel.where((row) => row.int.eq([1, 2, 3]))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.int.eq([1, 2, 3])))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);

        expect(
          await db.public.TestModel.where((row) => row.float.eq([1.1, 2.2, 3.3]))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.float.eq([1.1, 2.2, 3.3])))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);

        expect(
          await db.public.TestModel.where((row) => row.bInt.eq([100n, 200n, 300n]))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.bInt.eq([100n, 200n, 300n])))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);

        expect(
          await db.public.TestModel.where((row) => row.bool.eq([true]))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.bool.eq([true])))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);

        expect(
          await db.public.TestModel.where((row) => row.bytes.eq([testBytes, tBytes]))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.bytes.eq([testBytes, tBytes])))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);

        expect(
          await db.public.TestModel.where((row) => row.dt.eq([firstDate, secondDate]))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.dt.eq([firstDate, secondDate])))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'equality for decimal lists',
    () =>
      withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, async ({ db }) => {
        const values = ['11.11', '22.22', '33.33'] as DecimalListInput;
        await db.public.TestModel.createAll([
          { id: 1, decimal: values },
          { id: 2, decimal: [] },
        ]);

        expect(
          await db.public.TestModel.where((row) => row.decimal.eq(values))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.decimal.eq(values)))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it.fails(
    'equality for JSON lists',
    () =>
      withPostgresPort<JsonContract>({ contractJson: jsonContractJson }, async ({ db }) => {
        const objectValues = [{}, { int: 5 }, [1, 2, 3]];
        const nullValues = [null, 'test'];
        await db.public.TestModel.createAll([
          { id: 1, json: objectValues },
          { id: 2, json: [] },
          { id: 3, json: nullValues },
        ]);

        expect(
          await db.public.TestModel.where((row) => row.json.eq(objectValues))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }]);
        expect(
          await db.public.TestModel.where((row) => row.json.eq(nullValues))
            .select('id')
            .all(),
        ).toEqual([{ id: 3 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.json.eq(objectValues)))
            .select('id')
            .all(),
        ).toEqual([{ id: 2 }, { id: 3 }]);
        expect(
          await db.public.TestModel.where((row) => not(row.json.eq(nullValues)))
            .select('id')
            .all(),
        ).toEqual([{ id: 1 }, { id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
