import type { AnyExpression } from '@internal/sql-relational-core/ast';
import { BinaryExpr, ColumnRef, NotExpr } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../_harness/postgres';
import type { Contract as ListContract } from '../_fixture/list/generated/contract';
import listContractJson from '../_fixture/list/generated/contract.json' with { type: 'json' };
import type { Contract as MixedContract } from '../_fixture/mixed/generated/contract';
import mixedContractJson from '../_fixture/mixed/generated/contract.json' with { type: 'json' };
import {
  commonListRows,
  commonMixedRows,
  referencedListHasEvery,
  referencedListHasScalar,
  referencedListHasSome,
  referencedScalarInList,
} from '../postgres-list-field-reference';
import type { Contract } from './_fixture/generated/contract';
import contractJson from './_fixture/generated/contract.json' with { type: 'json' };

const column = (name: string) => ColumnRef.of('testModel', name);

function withMixedBigIntFieldReference(fn: Parameters<typeof withPostgresPort<MixedContract>>[1]) {
  return withPostgresPort<MixedContract>({ contractJson: mixedContractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll(commonMixedRows());
    await fn(ctx);
  });
}

function withListBigIntFieldReference(fn: Parameters<typeof withPostgresPort<ListContract>>[1]) {
  return withPostgresPort<ListContract>({ contractJson: listContractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll(commonListRows());
    await fn(ctx);
  });
}

function withBigIntFieldReference(fn: Parameters<typeof withPostgresPort<Contract>>[1]) {
  return withPostgresPort<Contract>({ contractJson }, async (ctx) => {
    await ctx.db.public.TestModel.createAll([
      {
        id: 1,
        string: 'abc',
        string2: 'abc',
        int: 1,
        int2: 1,
        bInt: 1n,
        bInt2: 1n,
        float: 1.5,
        float2: 1.5,
        bytes: Uint8Array.from([1, 2, 3]),
        bytes2: Uint8Array.from([1, 2, 3]),
        bool: false,
        bool2: false,
        dt: Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
        dt2: Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
      },
      {
        id: 2,
        string: 'abc',
        string2: 'bcd',
        int: 1,
        int2: 2,
        bInt: 1n,
        bInt2: 2n,
        float: 1.5,
        float2: 2.4,
        bytes: Uint8Array.from([1, 2, 3]),
        bytes2: Uint8Array.from([1, 2, 3, 4]),
        bool: false,
        bool2: true,
        dt: Temporal.Instant.from('1900-10-10T01:10:10.001Z'),
        dt2: Temporal.Instant.from('1901-10-10T01:10:10.001Z'),
      },
      { id: 3 },
    ]);
    await fn(ctx);
  });
}

describe('ports/engines/queries/filters/field-reference/bigint-filter', () => {
  it(
    'basic_where',
    () =>
      withBigIntFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();

        expect(await ids(BinaryExpr.eq(column('bInt'), column('bInt')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(BinaryExpr.eq(column('bInt'), column('bInt2')))).toEqual([{ id: 1 }]);
        expect(await ids(new NotExpr(BinaryExpr.eq(column('bInt'), column('bInt2'))))).toEqual([
          { id: 2 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'numeric_comparison_filters',
    () =>
      withBigIntFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();

        expect(await ids(BinaryExpr.gt(column('bInt'), column('bInt')))).toEqual([]);
        expect(await ids(BinaryExpr.gt(column('bInt2'), column('bInt')))).toEqual([{ id: 2 }]);
        expect(await ids(new NotExpr(BinaryExpr.gt(column('bInt'), column('bInt'))))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(new NotExpr(BinaryExpr.gt(column('bInt'), column('bInt2'))))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);

        expect(await ids(BinaryExpr.gte(column('bInt'), column('bInt')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(BinaryExpr.gte(column('bInt2'), column('bInt')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(new NotExpr(BinaryExpr.gte(column('bInt'), column('bInt'))))).toEqual([]);
        expect(await ids(new NotExpr(BinaryExpr.gte(column('bInt'), column('bInt2'))))).toEqual([
          { id: 2 },
        ]);

        expect(await ids(BinaryExpr.lt(column('bInt'), column('bInt')))).toEqual([]);
        expect(await ids(BinaryExpr.lt(column('bInt'), column('bInt2')))).toEqual([{ id: 2 }]);
        expect(await ids(new NotExpr(BinaryExpr.lt(column('bInt'), column('bInt'))))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(new NotExpr(BinaryExpr.lt(column('bInt2'), column('bInt'))))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);

        expect(await ids(BinaryExpr.lte(column('bInt'), column('bInt')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(BinaryExpr.lte(column('bInt'), column('bInt2')))).toEqual([
          { id: 1 },
          { id: 2 },
        ]);
        expect(await ids(new NotExpr(BinaryExpr.lte(column('bInt'), column('bInt'))))).toEqual([]);
        expect(await ids(new NotExpr(BinaryExpr.lte(column('bInt2'), column('bInt'))))).toEqual([
          { id: 2 },
        ]);
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'inclusion_filter',
    () =>
      withMixedBigIntFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();
        const scalar = column('bInt');
        const list = column('bInt2');

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
      withListBigIntFieldReference(async ({ db }) => {
        const ids = (filter: AnyExpression) =>
          db.public.TestModel.where(filter)
            .orderBy((row) => row.id.asc())
            .select('id')
            .all();
        const scalar = column('bInt');
        const list = column('bInt_list');
        const otherList = column('bInt_list2');

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
