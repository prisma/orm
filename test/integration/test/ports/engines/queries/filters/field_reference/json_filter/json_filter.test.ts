import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { BinaryExpr, ColumnRef, NotExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import {
  referencedListHasEvery,
  referencedListHasScalar,
  referencedListHasSome,
} from '../postgres-list-field-reference';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };
import type { Contract as ListContract } from './_fixture/list/generated/contract';
import listContractJson from './_fixture/list/generated/contract.json' with { type: 'json' };

const column = (name: string) => ColumnRef.of('testModel', name);

function withJsonListFieldReference(fn: Parameters<typeof withPostgresPort<ListContract>>[1]) {
  return withPostgresPort<ListContract>({ contractJson: listContractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll([
      {
        id: 1,
        json: { a: 1 },
        json_list: [{ a: 1 }, { a: 1 }],
        json_list2: [{ a: 1 }, { a: 1 }],
      },
      {
        id: 2,
        json: { a: 4 },
        json_list: [{ a: 1 }, { a: 2 }],
        json_list2: [{ a: 2 }, { a: 3 }],
      },
      { id: 3, json_list: [], json_list2: [] },
    ]);
    await fn(ctx);
  });
}

describe('ports/engines/queries/filters/field-reference/json-filter', () => {
  it(
    'basic_where',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.TestModel.select('id').createAll([
          { id: 1, json: { a: { b: 'c' } }, json2: { a: { b: 'c' } } },
          { id: 2, json: { a: { b: 'a' } }, json2: 'b' },
          { id: 3, json: { a: { b: 2 } }, json2: 1 },
          { id: 4 },
        ]);

        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();

        expect(await ids(BinaryExpr.eq(column('json'), column('json')))).toEqual([
          { id: 1 },
          { id: 2 },
          { id: 3 },
        ]);
        expect(await ids(BinaryExpr.eq(column('json'), column('json2')))).toEqual([{ id: 1 }]);
        expect(await ids(new NotExpr(BinaryExpr.eq(column('json'), column('json2'))))).toEqual([
          { id: 2 },
          { id: 3 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'scalar_list_filters',
    () =>
      withJsonListFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();
        const scalar = column('json');
        const list = column('json_list');
        const otherList = column('json_list2');

        expect(await ids(referencedListHasScalar(list, scalar))).toEqual([{ id: 1 }]);
        expect(await ids(referencedListHasScalar(list, scalar, true))).toEqual([{ id: 2 }]);

        expect(await ids(referencedListHasSome(list, list))).toEqual([{ id: 1 }, { id: 2 }]);
        expect(await ids(referencedListHasSome(list, otherList))).toEqual([{ id: 1 }, { id: 2 }]);
        expect(await ids(referencedListHasSome(list, list, true))).toEqual([]);
        expect(await ids(referencedListHasSome(list, otherList, true))).toEqual([]);

        expect(await ids(referencedListHasEvery(list, list))).toEqual([{ id: 1 }, { id: 2 }]);
        expect(await ids(referencedListHasEvery(list, otherList))).toEqual([{ id: 1 }]);
        expect(await ids(referencedListHasEvery(list, list, true))).toEqual([]);
        expect(await ids(referencedListHasEvery(list, otherList, true))).toEqual([{ id: 2 }]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'preserves nulls inside JSON values',
    () =>
      withPostgresPort<Contract>({ contractJson }, async ({ db }) => {
        await db.public.TestModel.create({ id: 1, json: { a: null } });

        const rows = await db.public.TestModel.select('id', 'json').all();

        expect(rows).toEqual([{ id: 1, json: { a: null } }]);
      }),
    timeouts.spinUpPpgDev,
  );
});
