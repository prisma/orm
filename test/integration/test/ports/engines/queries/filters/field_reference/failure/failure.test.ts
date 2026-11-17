import { AggregateExpr, BinaryExpr, ColumnRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { timeouts, withPostgresPort } from '../../../../../../_harness/postgres';
import type { Contract as CommonContract } from './_fixture/common/generated/contract';
import commonContractJson from './_fixture/common/generated/contract.json' with { type: 'json' };
import type { Contract as DefaultContract } from './_fixture/default/generated/contract';
import defaultContractJson from './_fixture/default/generated/contract.json' with { type: 'json' };
import type { Contract as ListContract } from './_fixture/list/generated/contract';
import listContractJson from './_fixture/list/generated/contract.json' with { type: 'json' };

const testModelColumn = (name: string) => ColumnRef.of('testModel', name);
const childColumn = (name: string) => ColumnRef.of('child', name);

function sqlQueryError(sqlState: string, message: string) {
  return { name: 'SqlQueryError', kind: 'sql_query', sqlState, message };
}

function withDefaultFailure(fn: Parameters<typeof withPostgresPort<DefaultContract>>[1]) {
  return withPostgresPort<DefaultContract>({ contractJson: defaultContractJson }, fn);
}

function withListFailure(fn: Parameters<typeof withPostgresPort<ListContract>>[1]) {
  return withPostgresPort<ListContract>({ contractJson: listContractJson }, fn);
}

function withCommonFailure(fn: Parameters<typeof withPostgresPort<CommonContract>>[1]) {
  return withPostgresPort<CommonContract>({ contractJson: commonContractJson }, fn);
}

describe('ports/engines/queries/filters/field-reference/failure', () => {
  it(
    'unknown_field_name_fails',
    () =>
      withDefaultFailure(async ({ db }) => {
        await expect(
          db.public.TestModel.where(
            BinaryExpr.eq(testModelColumn('id'), testModelColumn('unknown')),
          )
            .select('id')
            .all(),
        ).rejects.toMatchObject(sqlQueryError('42703', 'column testModel.unknown does not exist'));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'fields_of_different_models_fails',
    () =>
      withDefaultFailure(async ({ db }) => {
        await expect(
          db.public.TestModel.where(BinaryExpr.eq(testModelColumn('id'), childColumn('testId')))
            .select('id')
            .all(),
        ).rejects.toMatchObject(
          sqlQueryError('42P01', 'missing FROM-clause entry for table "child"'),
        );
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'relation_field_name_fails',
    () =>
      withDefaultFailure(async ({ db }) => {
        await expect(
          db.public.TestModel.where(
            BinaryExpr.eq(testModelColumn('id'), testModelColumn('children')),
          )
            .select('id')
            .all(),
        ).rejects.toMatchObject(sqlQueryError('42703', 'column testModel.children does not exist'));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'fields_of_different_type_fails',
    () =>
      withDefaultFailure(async ({ db }) => {
        await expect(
          db.public.TestModel.where(BinaryExpr.eq(testModelColumn('id'), testModelColumn('str')))
            .select('id')
            .all(),
        ).rejects.toMatchObject(sqlQueryError('42883', 'operator does not exist: integer = text'));

        await expect(
          db.public.TestModel.where((model) =>
            model.children.some(() => BinaryExpr.eq(childColumn('id'), childColumn('str'))),
          )
            .select('id')
            .all(),
        ).rejects.toMatchObject(sqlQueryError('42883', 'operator does not exist: integer = text'));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'field_of_different_arity_fails',
    () =>
      withListFailure(async ({ db }) => {
        await expect(
          db.public.TestModel.where(
            BinaryExpr.eq(testModelColumn('str'), testModelColumn('str_list')),
          )
            .select('id')
            .all(),
        ).rejects.toMatchObject(sqlQueryError('42883', 'operator does not exist: text = text[]'));

        await expect(
          db.public.TestModel.where((model) =>
            model.children.some(() => BinaryExpr.eq(childColumn('str'), childColumn('str_list'))),
          )
            .select('id')
            .all(),
        ).rejects.toMatchObject(sqlQueryError('42883', 'operator does not exist: text = text[]'));
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'field_ref_in_having_must_be_selected',
    () =>
      withCommonFailure(async ({ db }) => {
        await expect(
          db.public.TestModel.groupBy('int')
            .having(() =>
              BinaryExpr.eq(AggregateExpr.count(testModelColumn('int')), testModelColumn('int2')),
            )
            .aggregate((aggregate) => ({ count: aggregate.count() })),
        ).rejects.toMatchObject(
          sqlQueryError(
            '42803',
            'column "testModel.int2" must appear in the GROUP BY clause or be used in an aggregate function',
          ),
        );
      }),
    timeouts.spinUpPpgDev,
  );

  it(
    'count_expect_int_field_ref',
    () =>
      withCommonFailure(async ({ db }) => {
        await db.public.TestModel.groupBy('string', 'int')
          .having(() =>
            BinaryExpr.eq(AggregateExpr.count(testModelColumn('string')), testModelColumn('int')),
          )
          .aggregate((aggregate) => ({ count: aggregate.count() }));

        await expect(
          db.public.TestModel.groupBy('string', 'int')
            .having(() =>
              BinaryExpr.eq(
                AggregateExpr.count(testModelColumn('string')),
                testModelColumn('string'),
              ),
            )
            .aggregate((aggregate) => ({ count: aggregate.count() })),
        ).rejects.toMatchObject(sqlQueryError('42883', 'operator does not exist: bigint = text'));
      }),
    timeouts.spinUpPpgDev,
  );
});
