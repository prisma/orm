import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { BinaryExpr, ColumnRef, NotExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import type { Contract as ListContract } from '../_fixture/decimal-list/generated/contract';
import listContractJson from '../_fixture/decimal-list/generated/contract.json' with {
  type: 'json',
};
import {
  referencedListHasEvery,
  referencedListHasScalar,
  referencedListHasSome,
  referencedScalarInList,
} from '../postgres-list-field-reference';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const column = (name: string) => ColumnRef.of('testModel', name);

function withListDecimalFieldReference(fn: Parameters<typeof withPostgresPort<ListContract>>[1]) {
  return withPostgresPort<ListContract>({ contractJson: listContractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll([
      {
        id: 1,
        dec: '1.5',
        dec_list: ['1.5', '2.4'],
        dec_list2: ['1.5', '2.4'],
      },
      {
        id: 2,
        dec: '1.2',
        dec_list: ['1.5', '2.4'],
        dec_list2: ['2.4', '3.7'],
      },
      { id: 3, dec_list: [], dec_list2: [] },
    ]);
    await fn(ctx);
  });
}

function withDecimalFieldReference(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll([
      { id: 1, dec: '1.2', dec2: '1.2' },
      { id: 2, dec: '1.2', dec2: '2.4' },
      { id: 3 },
    ]);
    await fn(ctx);
  });
}

describe('ports/engines/queries/filters/field-reference/decimal-filter', () => {
  it(
    'basic_where',
    () =>
      withDecimalFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();

        expect(await ids(BinaryExpr.eq(column('dec'), column('dec')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(BinaryExpr.eq(column('dec'), column('dec2')))).toEqual([{ id: 1 }]);
        expect(await ids(new NotExpr(BinaryExpr.eq(column('dec'), column('dec2'))))).toEqual([
          { id: 2 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric_comparison_filters',
    () =>
      withDecimalFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();

        expect(await ids(BinaryExpr.gt(column('dec'), column('dec')))).toEqual([]);
        expect(await ids(BinaryExpr.gt(column('dec2'), column('dec')))).toEqual([{ id: 2 }]);
        expect(await ids(new NotExpr(BinaryExpr.gt(column('dec'), column('dec'))))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(new NotExpr(BinaryExpr.gt(column('dec'), column('dec2'))))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);

        expect(await ids(BinaryExpr.gte(column('dec'), column('dec')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(BinaryExpr.gte(column('dec2'), column('dec')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(new NotExpr(BinaryExpr.gte(column('dec'), column('dec'))))).toEqual([]);
        expect(await ids(new NotExpr(BinaryExpr.gte(column('dec'), column('dec2'))))).toEqual([
          { id: 2 },
        ]);

        expect(await ids(BinaryExpr.lt(column('dec'), column('dec')))).toEqual([]);
        expect(await ids(BinaryExpr.lt(column('dec'), column('dec2')))).toEqual([{ id: 2 }]);
        expect(await ids(new NotExpr(BinaryExpr.lt(column('dec'), column('dec'))))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(new NotExpr(BinaryExpr.lt(column('dec2'), column('dec'))))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);

        expect(await ids(BinaryExpr.lte(column('dec'), column('dec')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(BinaryExpr.lte(column('dec'), column('dec2')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(new NotExpr(BinaryExpr.lte(column('dec'), column('dec'))))).toEqual([]);
        expect(await ids(new NotExpr(BinaryExpr.lte(column('dec2'), column('dec'))))).toEqual([
          { id: 2 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'inclusion_filter',
    () =>
      withListDecimalFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();
        const scalar = column('dec');
        const list = column('dec_list');

        expect(await ids(referencedScalarInList(scalar, list)), 'in').toEqual([{ id: 1 }]);
        expect(await ids(referencedScalarInList(scalar, list, true)), 'notIn').toEqual([{ id: 2 }]);
        expect(await ids(referencedScalarInList(scalar, list, true)), 'not: { in }').toEqual([
          { id: 2 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'scalar_list_filters',
    () =>
      withListDecimalFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();
        const scalar = column('dec');
        const list = column('dec_list');
        const otherList = column('dec_list2');

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
});
