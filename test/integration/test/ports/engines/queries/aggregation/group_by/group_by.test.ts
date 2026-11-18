import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as MainContract } from './_fixture/main/generated/contract';
import mainContractJson from './_fixture/main/generated/contract.json' with { type: 'json' };
import type { Contract as Regression21789Contract } from './_fixture/regression-21789/generated/contract';
import regression21789ContractJson from './_fixture/regression-21789/generated/contract.json' with {
  type: 'json',
};

type MainContext = import('../../../../../_harness/postgres').PortContext<MainContract>;
type MainClient = MainContext['client'];
type MainDb = MainContext['db'];

function withMainGroupBy(fn: Parameters<typeof withPostgresPort<MainContract>>[1]) {
  return withPostgresPort<MainContract>({ contractJson: mainContractJson }, fn);
}

function mainSql(client: MainClient) {
  return client.sql;
}

function sqlQueryError(sqlState: string, message: string) {
  return { name: 'SqlQueryError', kind: 'sql_query', sqlState, message };
}

async function seedBasicRows(db: MainDb) {
  await db.public.A.createAll([
    { id: 1, float: 10.1, int: 5, string: 'group1' },
    { id: 2, float: 5.5, int: 0, string: 'group1' },
    { id: 3, float: 10, int: 5, string: 'group2' },
    { id: 4, float: 10, int: 5, string: 'group3' },
  ]);
}

async function seedOrderingRows(db: MainDb) {
  await db.public.A.createAll([
    { id: 1, float: 1.1, int: 1, string: 'group1' },
    { id: 2, float: 1.1, int: 2, string: 'group1' },
    { id: 3, float: 1.1, int: 3, string: 'group2' },
    { id: 4, float: 4, int: 3, string: 'group3' },
  ]);
}

describe('ports/engines/queries/aggregation/group_by', () => {
  it(
    'returns no groups with no records',
    () =>
      withMainGroupBy(async ({ client }) => {
        const query = mainSql(client);
        const result = await client
          .runtime()
          .query(
            query.public.a
              .select('count', (fields, functions) => functions.count(fields.a.id))
              .select('float')
              .select('sum', (fields, functions) => functions.sum(fields.a.int))
              .groupBy('id', 'float', 'int')
              .build(),
          )
          .toArray();

        expect(result).toEqual([]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'groups records with field count and sum',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await seedBasicRows(db);
        const query = mainSql(client);
        const result = await client
          .runtime()
          .query(
            query.public.a
              .select('string')
              .select('count', (fields, functions) => functions.count(fields.a.string))
              .select('sum', (fields, functions) => functions.sum(fields.a.float))
              .groupBy('string')
              .orderBy('string')
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { string: 'group1', count: 2, sum: 15.6 },
          { string: 'group2', count: 1, sum: 10 },
          { string: 'group3', count: 1, sum: 10 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'orders grouped records in reverse',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await seedBasicRows(db);
        const query = mainSql(client);
        const result = await client
          .runtime()
          .query(
            query.public.a
              .select('string')
              .select('count', (fields, functions) => functions.count(fields.a.string))
              .select('sum', (fields, functions) => functions.sum(fields.a.float))
              .groupBy('string')
              .orderBy('string', { direction: 'desc' })
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { string: 'group3', count: 1, sum: 10 },
          { string: 'group2', count: 1, sum: 10 },
          { string: 'group1', count: 2, sum: 15.6 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'orders groups by multiple fields',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await db.public.A.createAll([
          { id: 1, float: 10.1, int: 5, string: 'group1' },
          { id: 2, float: 5.5, int: 0, string: 'group1' },
          { id: 3, float: 10, int: 5, string: 'group2' },
          { id: 4, float: 10, int: 5, string: 'group3' },
          { id: 5, float: 15, int: 5, string: 'group3' },
        ]);
        const query = mainSql(client);
        const result = await client
          .runtime()
          .query(
            query.public.a
              .select('string')
              .select('count', (fields, functions) => functions.count(fields.a.string))
              .select('sum', (fields, functions) => functions.sum(fields.a.float))
              .select('min', (fields, functions) => functions.min(fields.a.int))
              .groupBy('string', 'int')
              .orderBy('string', { direction: 'desc' })
              .orderBy('int')
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { string: 'group3', count: 2, sum: 25, min: 5 },
          { string: 'group2', count: 1, sum: 10, min: 5 },
          { string: 'group1', count: 1, sum: 5.5, min: 0 },
          { string: 'group1', count: 1, sum: 10.1, min: 5 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'applies scalar filters before grouping',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await db.public.A.createAll([
          { id: 1, float: 10.1, int: 5, string: 'group1' },
          { id: 2, float: 5.5, int: 0, string: 'group1' },
          { id: 3, float: 10, int: 5, string: 'group2' },
          { id: 4, float: 10, int: 5, string: 'group3' },
          { id: 5, float: 15, int: 5, string: 'group3' },
        ]);
        const query = mainSql(client);
        const result = await client
          .runtime()
          .query(
            query.public.a
              .select('string')
              .select('count', (fields, functions) => functions.count(fields.a.string))
              .select('sum', (fields, functions) => functions.sum(fields.a.float))
              .select('min', (fields, functions) => functions.min(fields.a.int))
              .where((fields, functions) =>
                functions.and(functions.eq(fields.a.int, 5), functions.lt(fields.a.float, 15)),
              )
              .groupBy('string', 'int')
              .orderBy('string', { direction: 'desc' })
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { string: 'group3', count: 1, sum: 10, min: 5 },
          { string: 'group2', count: 1, sum: 10, min: 5 },
          { string: 'group1', count: 1, sum: 10.1, min: 5 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'applies relation filters before grouping',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await db.public.A.create({
          id: 1,
          float: 10.1,
          int: 5,
          string: 'group1',
          b: (relation) => relation.create({ id: 1, field: 'a' }),
        });
        await db.public.A.create({ id: 2, float: 5.5, int: 0, string: 'group1' });
        await db.public.A.create({ id: 3, float: 10, int: 5, string: 'group2' });
        await db.public.A.create({
          id: 4,
          float: 10,
          int: 5,
          string: 'group3',
          b: (relation) => relation.create({ id: 2, field: 'b' }),
        });
        await db.public.A.create({
          id: 5,
          float: 15,
          int: 5,
          string: 'group3',
          b: (relation) => relation.create({ id: 3, field: 'b' }),
        });

        const query = mainSql(client);
        const selectedRelations = () =>
          query.public.a
            .innerJoin(query.public.b, (fields, functions) =>
              functions.eq(fields.a.b_id, fields.b.id),
            )
            .select('string')
            .select('count', (fields, functions) => functions.count(fields.a.string))
            .select('sum', (fields, functions) => functions.sum(fields.a.float))
            .select('min', (fields, functions) => functions.min(fields.a.int));
        const relationExists = await client
          .runtime()
          .query(
            selectedRelations()
              .groupBy('string', 'int')
              .orderBy('string', { direction: 'desc' })
              .build(),
          )
          .toArray();
        const relationFieldB = await client
          .runtime()
          .query(
            selectedRelations()
              .where((fields, functions) => functions.eq(fields.b.field, 'b'))
              .groupBy('string', 'int')
              .orderBy('string', { direction: 'desc' })
              .build(),
          )
          .toArray();

        expect(relationExists).toEqual([
          { string: 'group3', count: 2, sum: 25, min: 5 },
          { string: 'group1', count: 1, sum: 10.1, min: 5 },
        ]);
        expect(relationFieldB).toEqual([{ string: 'group3', count: 2, sum: 25, min: 5 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'orders groups by count aggregation',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await seedOrderingRows(db);
        const query = mainSql(client);
        const grouped = () =>
          query.public.a
            .select('float')
            .select('count', (fields, functions) => functions.count(fields.a.float))
            .groupBy('float');
        const ascending = await client
          .runtime()
          .query(
            grouped()
              .orderBy((fields, functions) => functions.count(fields.a.float))
              .build(),
          )
          .toArray();
        const descending = await client
          .runtime()
          .query(
            grouped()
              .orderBy((fields, functions) => functions.count(fields.a.float), {
                direction: 'desc',
              })
              .build(),
          )
          .toArray();

        expect(ascending).toEqual([
          { float: 4, count: 1 },
          { float: 1.1, count: 3 },
        ]);
        expect(descending).toEqual([
          { float: 1.1, count: 3 },
          { float: 4, count: 1 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'orders groups by sum aggregation',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await seedOrderingRows(db);
        const query = mainSql(client);
        const grouped = () =>
          query.public.a
            .select('float')
            .select('sum', (fields, functions) => functions.sum(fields.a.float))
            .groupBy('float');
        const ascending = await client
          .runtime()
          .query(
            grouped()
              .orderBy((fields, functions) => functions.sum(fields.a.float))
              .build(),
          )
          .toArray();
        const descending = await client
          .runtime()
          .query(
            grouped()
              .orderBy((fields, functions) => functions.sum(fields.a.float), {
                direction: 'desc',
              })
              .build(),
          )
          .toArray();

        expect(ascending).toEqual([
          { float: 1.1, sum: 3.3000000000000003 },
          { float: 4, sum: 4 },
        ]);
        expect(descending).toEqual([
          { float: 4, sum: 4 },
          { float: 1.1, sum: 3.3000000000000003 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  for (const operation of ['avg', 'min', 'max'] as const) {
    it(
      `orders groups by ${operation} aggregation`,
      () =>
        withMainGroupBy(async ({ client, db }) => {
          await seedOrderingRows(db);
          const query = mainSql(client);
          const grouped = () =>
            query.public.a
              .select('float')
              .select(operation, (fields, functions) => functions[operation](fields.a.float))
              .groupBy('float');
          const ascending = await client
            .runtime()
            .query(
              grouped()
                .orderBy((fields, functions) => functions[operation](fields.a.float))
                .build(),
            )
            .toArray();
          const descending = await client
            .runtime()
            .query(
              grouped()
                .orderBy((fields, functions) => functions[operation](fields.a.float), {
                  direction: 'desc',
                })
                .build(),
            )
            .toArray();

          expect(ascending).toEqual([
            { float: 1.1, [operation]: 1.1 },
            { float: 4, [operation]: 4 },
          ]);
          expect(descending).toEqual([
            { float: 4, [operation]: 4 },
            { float: 1.1, [operation]: 1.1 },
          ]);
        }),
      timeouts.spinUpPpgDev,
    );
  }

  it(
    'orders groups by multiple aggregations',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await db.public.A.createAll([
          { id: 1, float: 1.1, int: 1, string: 'group1' },
          { id: 2, float: 1.1, int: 1, string: 'group1' },
          { id: 3, float: 1.1, int: 1, string: 'group2' },
          { id: 4, float: 3, int: 3, string: 'group3' },
          { id: 5, float: 4, int: 4, string: 'group3' },
        ]);
        const query = mainSql(client);
        const result = await client
          .runtime()
          .query(
            query.public.a
              .select('float')
              .select('count', (fields, functions) => functions.count(fields.a.float))
              .select('sum', (fields, functions) => functions.sum(fields.a.int))
              .groupBy('float', 'int')
              .orderBy((fields, functions) => functions.count(fields.a.float), {
                direction: 'desc',
              })
              .orderBy((fields, functions) => functions.sum(fields.a.int))
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { float: 1.1, count: 3, sum: 3 },
          { float: 3, count: 1, sum: 3 },
          { float: 4, count: 1, sum: 4 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'combines aggregate ordering with having',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await db.public.A.createAll([
          { id: 1, float: 1.1, int: 1, string: 'group1' },
          { id: 2, float: 1.1, int: 1, string: 'group1' },
          { id: 3, float: 1.1, int: 1, string: 'group2' },
          { id: 4, float: 3, int: 3, string: 'group3' },
          { id: 5, float: 4, int: 4, string: 'group3' },
        ]);
        const query = mainSql(client);
        const result = await client
          .runtime()
          .query(
            query.public.a
              .select('float')
              .select('count', (fields, functions) => functions.count(fields.a.float))
              .select('sum', (fields, functions) => functions.sum(fields.a.int))
              .groupBy('float', 'int')
              .having((fields, functions) => functions.lt(fields.a.float, 4))
              .orderBy((fields, functions) => functions.count(fields.a.float), {
                direction: 'desc',
              })
              .orderBy((fields, functions) => functions.sum(fields.a.int))
              .build(),
          )
          .toArray();

        expect(result).toEqual([
          { float: 1.1, count: 3, sum: 3 },
          { float: 3, count: 1, sum: 3 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'orders by an aggregation without selecting it',
    () =>
      withMainGroupBy(async ({ client, db }) => {
        await db.public.A.createAll([
          { id: 1, float: 1.1, int: 1, string: 'group1' },
          { id: 2, float: 1.1, int: 1, string: 'group1' },
          { id: 3, float: 1.1, int: 1, string: 'group2' },
        ]);
        const query = mainSql(client);
        const result = await client
          .runtime()
          .query(
            query.public.a
              .select('sum', (fields, functions) => functions.sum(fields.a.int))
              .groupBy('float')
              .orderBy((fields, functions) => functions.count(fields.a.float), {
                direction: 'desc',
              })
              .build(),
          )
          .toArray();

        expect(result).toEqual([{ sum: 3 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'computes enum extrema globally and per group',
    () =>
      withPostgresPort<Regression21789Contract>(
        { contractJson: regression21789ContractJson },
        async ({ client, db }) => {
          await db.public.Test.createAll([
            { id: 1, group: 1, color: 'red' },
            { id: 2, group: 2, color: 'green' },
            { id: 3, group: 1, color: 'blue' },
          ]);

          const aggregateResult = await client
            .runtime()
            .query(
              client.sql.public.test
                .select('max', (fields, functions) => functions.max(fields.test.color))
                .select('min', (fields, functions) => functions.min(fields.test.color))
                .build(),
            )
            .toArray();
          const groupedResult = await client
            .runtime()
            .query(
              client.sql.public.test
                .select('group')
                .select('max', (fields, functions) => functions.max(fields.test.color))
                .select('min', (fields, functions) => functions.min(fields.test.color))
                .groupBy('group')
                .orderBy('group')
                .build(),
            )
            .toArray();

          expect(aggregateResult).toEqual([{ max: 'green', min: 'blue' }]);
          expect(groupedResult).toEqual([
            { group: 1, max: 'red', min: 'blue' },
            { group: 2, max: 'green', min: 'green' },
          ]);
        },
      ),
    timeouts.spinUpPpgDev,
  );

  it(
    'rejects scalar selection with no grouping fields',
    () =>
      withMainGroupBy(async ({ client }) => {
        const query = mainSql(client);

        expect(() => query.public.a.select('string').groupBy()).toThrow(
          expect.objectContaining({
            name: 'StructuredError',
            code: 'ORM.ARGUMENT_INVALID',
            message: 'Invalid groupBy arguments',
          }),
        );
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'rejects a selected scalar absent from grouping fields',
    () =>
      withMainGroupBy(async ({ client }) => {
        const query = mainSql(client);

        await expect(
          client
            .runtime()
            .query(
              query.public.a
                .select('string')
                .select('count', (fields, functions) => functions.count(fields.a.string))
                .select('sum', (fields, functions) => functions.sum(fields.a.float))
                .groupBy('int')
                .build(),
            )
            .toArray(),
        ).rejects.toMatchObject(
          sqlQueryError(
            '42803',
            'column "a.string" must appear in the GROUP BY clause or be used in an aggregate function',
          ),
        );
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'rejects an ordered scalar absent from grouping fields',
    () =>
      withMainGroupBy(async ({ client }) => {
        const query = mainSql(client);

        await expect(
          client
            .runtime()
            .query(
              query.public.a
                .select('count', (fields, functions) => functions.count(fields.a.int))
                .select('sum', (fields, functions) => functions.sum(fields.a.float))
                .groupBy('int')
                .orderBy('string', { direction: 'desc' })
                .build(),
            )
            .toArray(),
        ).rejects.toMatchObject(
          sqlQueryError(
            '42803',
            'column "a.string" must appear in the GROUP BY clause or be used in an aggregate function',
          ),
        );
      }),
    timeouts.spinUpPpgDev,
  );
});
