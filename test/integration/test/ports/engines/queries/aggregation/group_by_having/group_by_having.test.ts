import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as CommonContract } from './_fixture/common/generated/contract';
import commonContractJson from './_fixture/common/generated/contract.json' with { type: 'json' };
import type { Contract as DecimalContract } from './_fixture/decimal/generated/contract';
import decimalContractJson from './_fixture/decimal/generated/contract.json' with { type: 'json' };

function withCommonGroupByHaving(fn: Parameters<typeof withPostgresPort<CommonContract>>[1]) {
  return withPostgresPort<CommonContract>({ contractJson: commonContractJson }, fn);
}

function withDecimalGroupByHaving(fn: Parameters<typeof withPostgresPort<DecimalContract>>[1]) {
  return withPostgresPort<DecimalContract>({ contractJson: decimalContractJson }, fn);
}

describe('ports/engines/queries/aggregation/group_by_having', () => {
  it(
    'basic_having_scalar_filter',
    () =>
      withCommonGroupByHaving(async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, float: 10.1, int: 5, bInt: 12n, string: 'group1' },
          { id: 2, float: 5.5, int: 0, bInt: 3n, string: 'group1' },
          { id: 3, float: 10, int: 5, bInt: 3n, string: 'group2' },
          { id: 4, float: 10, int: 5, bInt: 3n, string: 'group3' },
        ]);

        const result = await client
          .runtime()
          .query(
            client.sql.public.testModel
              .select('string', 'int')
              .select('count', (_fields, functions) => functions.count())
              .select('sum', (fields, functions) => functions.sum(fields.testModel.int))
              .groupBy('string', 'int')
              .having((fields, functions) =>
                functions.and(
                  functions.in(fields.testModel.string, ['group1', 'group2']),
                  functions.eq(fields.testModel.int, 5),
                ),
              )
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { string: 'group1', int: 5, count: 1, sum: 5 },
          { string: 'group2', int: 5, count: 1, sum: 5 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'having_count_scalar_filter',
    () =>
      withCommonGroupByHaving(async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, int: 1, string: 'group1' },
          { id: 2, int: 2, string: 'group1' },
          { id: 3, int: 3, string: 'group2' },
          { id: 4, string: 'group2' },
          { id: 5, string: 'group3' },
          { id: 6, string: 'group3' },
        ]);

        const grouped = () =>
          client.sql.public.testModel
            .select('string')
            .select('count', (fields, functions) => functions.count(fields.testModel.int))
            .groupBy('string')
            .orderBy('string');

        const equals = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) => functions.eq(functions.count(fields.testModel.int), 2))
              .build(),
          )
          .toArray();
        const notEquals = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) => functions.ne(functions.count(fields.testModel.int), 2))
              .build(),
          )
          .toArray();
        const included = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.in(functions.count(fields.testModel.int), [0, 2]),
              )
              .build(),
          )
          .toArray();

        expect(equals).toEqual([{ string: 'group1', count: 2 }]);
        expect(notEquals).toEqual([
          { string: 'group2', count: 1 },
          { string: 'group3', count: 0 },
        ]);
        expect(included).toEqual([
          { string: 'group1', count: 2 },
          { string: 'group3', count: 0 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'having_sum_scalar_filter',
    () =>
      withCommonGroupByHaving(async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, float: 10, int: 10, string: 'group1' },
          { id: 2, float: 6, int: 6, string: 'group1' },
          { id: 3, float: 5, int: 5, string: 'group2' },
          { id: 4, string: 'group2' },
          { id: 5, string: 'group3' },
          { id: 6, string: 'group3' },
        ]);

        const grouped = () =>
          client.sql.public.testModel
            .select('string')
            .select('float', (fields, functions) => functions.sum(fields.testModel.float))
            .select('int', (fields, functions) => functions.sum(fields.testModel.int))
            .groupBy('string')
            .orderBy('string');
        const equals = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.eq(functions.sum(fields.testModel.float), 16),
                  functions.eq(functions.sum(fields.testModel.int), 16),
                ),
              )
              .build(),
          )
          .toArray();
        const notEquals = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.ne(functions.sum(fields.testModel.float), 16),
                  functions.ne(functions.sum(fields.testModel.int), 16),
                ),
              )
              .build(),
          )
          .toArray();
        const included = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.in(functions.sum(fields.testModel.float), [16, 5]),
                  functions.in(functions.sum(fields.testModel.int), [16, 5]),
                ),
              )
              .build(),
          )
          .toArray();

        expect(equals).toEqual([{ string: 'group1', float: 16, int: 16 }]);
        expect(notEquals).toEqual([{ string: 'group2', float: 5, int: 5 }]);
        expect(included).toEqual([
          { string: 'group1', float: 16, int: 16 },
          { string: 'group2', float: 5, int: 5 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'having_min_scalar_filter',
    () =>
      withCommonGroupByHaving(async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, float: 10, int: 10, string: 'group1' },
          { id: 2, float: 0, int: 0, string: 'group1' },
          { id: 3, float: 0, int: 0, string: 'group2' },
          { id: 4, string: 'group2' },
          { id: 5, string: 'group3' },
          { id: 6, string: 'group3' },
        ]);

        const grouped = () =>
          client.sql.public.testModel
            .select('string')
            .select('float', (fields, functions) => functions.min(fields.testModel.float))
            .select('int', (fields, functions) => functions.min(fields.testModel.int))
            .groupBy('string')
            .orderBy('string');

        const equals = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.eq(functions.min(fields.testModel.float), 0),
                  functions.eq(functions.min(fields.testModel.int), 0),
                ),
              )
              .build(),
          )
          .toArray();
        const notEquals = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.ne(functions.min(fields.testModel.float), 0),
                  functions.ne(functions.min(fields.testModel.int), 0),
                ),
              )
              .build(),
          )
          .toArray();
        const included = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.in(functions.min(fields.testModel.float), [0]),
                  functions.in(functions.min(fields.testModel.int), [0]),
                ),
              )
              .build(),
          )
          .toArray();

        expect(equals).toEqual([
          { string: 'group1', float: 0, int: 0 },
          { string: 'group2', float: 0, int: 0 },
        ]);
        expect(notEquals).toEqual([]);
        expect(included).toEqual([
          { string: 'group1', float: 0, int: 0 },
          { string: 'group2', float: 0, int: 0 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'having_max_scalar_filter',
    () =>
      withCommonGroupByHaving(async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, float: 10, int: 10, string: 'group1' },
          { id: 2, float: 0, int: 0, string: 'group1' },
          { id: 3, float: 10, int: 10, string: 'group2' },
          { id: 4, string: 'group2' },
          { id: 5, string: 'group3' },
          { id: 6, string: 'group3' },
        ]);

        const grouped = () =>
          client.sql.public.testModel
            .select('string')
            .select('float', (fields, functions) => functions.max(fields.testModel.float))
            .select('int', (fields, functions) => functions.max(fields.testModel.int))
            .groupBy('string')
            .orderBy('string');

        const equals = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.eq(functions.max(fields.testModel.float), 10),
                  functions.eq(functions.max(fields.testModel.int), 10),
                ),
              )
              .build(),
          )
          .toArray();
        const notEquals = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.ne(functions.max(fields.testModel.float), 10),
                  functions.ne(functions.max(fields.testModel.int), 10),
                ),
              )
              .build(),
          )
          .toArray();
        const included = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.in(functions.max(fields.testModel.float), [10]),
                  functions.in(functions.max(fields.testModel.int), [10]),
                ),
              )
              .build(),
          )
          .toArray();

        expect(equals).toEqual([
          { string: 'group1', float: 10, int: 10 },
          { string: 'group2', float: 10, int: 10 },
        ]);
        expect(notEquals).toEqual([]);
        expect(included).toEqual([
          { string: 'group1', float: 10, int: 10 },
          { string: 'group2', float: 10, int: 10 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'having_count_non_numerical_field',
    () =>
      withCommonGroupByHaving(async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, float: 10, int: 10, string: 'group1' },
          { id: 2, float: 0, int: 0, string: 'group1' },
        ]);

        const result = await client
          .runtime()
          .query(
            client.sql.public.testModel
              .select('string')
              .select('count', (fields, functions) => functions.count(fields.testModel.string))
              .groupBy('string')
              .having((fields, functions) =>
                functions.gt(functions.count(fields.testModel.string), 1),
              )
              .build(),
          )
          .toArray();

        expect(result).toEqual([{ string: 'group1', count: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'having_without_aggr_sel',
    () =>
      withCommonGroupByHaving(async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, float: 10, int: 10, string: 'group1' },
          { id: 2, float: 0, int: 0, string: 'group1' },
          { id: 3, float: 10, int: 10, string: 'group2' },
          { id: 4, string: 'group2' },
          { id: 5, string: 'group3' },
          { id: 6, string: 'group3' },
        ]);

        const grouped = () => client.sql.public.testModel.select('string').groupBy('string');
        const maxResult = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) => functions.gt(functions.max(fields.testModel.int), 1))
              .build(),
          )
          .toArray();
        const combinedResult = await client
          .runtime()
          .query(
            grouped()
              .having((fields, functions) =>
                functions.and(
                  functions.gt(functions.max(fields.testModel.int), 1),
                  functions.gt(functions.sum(fields.testModel.int), 1),
                ),
              )
              .build(),
          )
          .toArray();
        const acceptedOrders = [
          [{ string: 'group1' }, { string: 'group2' }],
          [{ string: 'group2' }, { string: 'group1' }],
        ];

        expect(acceptedOrders).toContainEqual(maxResult);
        expect(acceptedOrders).toContainEqual(combinedResult);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'having_avg_scalar_filter',
    () =>
      withDecimalGroupByHaving(async ({ client }) => {
        await client.orm.public.TestModel.createAll([
          { id: 1, decimal: '10', string: 'group1' },
          { id: 2, decimal: '6', string: 'group1' },
          { id: 3, decimal: '5', string: 'group2' },
          { id: 4, decimal: null, string: 'group2' },
          { id: 5, decimal: null, string: 'group3' },
          { id: 6, decimal: null, string: 'group3' },
        ]);

        const result = await client.orm.public.TestModel.groupBy('string')
          .having((having) => having.avg('decimal').eq(8))
          .aggregate((aggregate) => ({ decimal: aggregate.avg('decimal') }));

        expect(result).toEqual([{ string: 'group1', decimal: '8.0000000000000000' }]);
      }),
    timeouts.spinUpPpgDev,
  );

  for (const operation of ['sum', 'min', 'max'] as const) {
    it(
      `decimal having_${operation}_scalar_filter`,
      () =>
        withDecimalGroupByHaving(async ({ client }) => {
          const values =
            operation === 'sum'
              ? [
                  { id: 1, decimal: '10', string: 'group1' },
                  { id: 2, decimal: '6', string: 'group1' },
                  { id: 3, decimal: '5', string: 'group2' },
                ]
              : [
                  { id: 1, decimal: '10', string: 'group1' },
                  { id: 2, decimal: '0', string: 'group1' },
                  { id: 3, decimal: operation === 'min' ? '0' : '10', string: 'group2' },
                ];
          await client.orm.public.TestModel.createAll([
            ...values,
            { id: 4, decimal: null, string: 'group2' },
            { id: 5, decimal: null, string: 'group3' },
            { id: 6, decimal: null, string: 'group3' },
          ]);

          const grouped = () =>
            client.sql.public.testModel
              .select('string')
              .select('decimal', (fields, functions) =>
                functions[operation](fields.testModel.decimal),
              )
              .groupBy('string')
              .orderBy('string');
          const filterValues =
            operation === 'sum' ? ['16', '5'] : operation === 'min' ? ['0'] : ['10'];
          const equals = await client
            .runtime()
            .query(
              grouped()
                .having((fields, functions) =>
                  functions.eq(functions[operation](fields.testModel.decimal), filterValues[0]!),
                )
                .build(),
            )
            .toArray();
          const notEquals = await client
            .runtime()
            .query(
              grouped()
                .having((fields, functions) =>
                  functions.ne(functions[operation](fields.testModel.decimal), filterValues[0]!),
                )
                .build(),
            )
            .toArray();
          const included = await client
            .runtime()
            .query(
              grouped()
                .having((fields, functions) =>
                  functions.in(functions[operation](fields.testModel.decimal), filterValues),
                )
                .build(),
            )
            .toArray();

          const selected =
            operation === 'sum'
              ? [
                  { string: 'group1', decimal: '16' },
                  { string: 'group2', decimal: '5' },
                ]
              : [
                  { string: 'group1', decimal: filterValues[0] },
                  { string: 'group2', decimal: filterValues[0] },
                ];
          expect(equals).toEqual(operation === 'sum' ? [selected[0]] : selected);
          expect(notEquals).toEqual(operation === 'sum' ? [selected[1]] : []);
          expect(included).toEqual(selected);
        }),
      timeouts.spinUpPpgDev,
    );
  }
});
