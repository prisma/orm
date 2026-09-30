import {
  ColumnRef,
  JsonArrayAggExpr,
  NativeJsonValueProjection,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
  WindowFuncExpr,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { createPostgresAdapter } from '../src/core/adapter';
import type { PostgresContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'test-profile',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'test-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            post: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                title: { codecId: 'pg/text@1', nativeType: 'text', nullable: true },
              },
              uniques: [],
              indexes: [],
              foreignKeys: [],
            },
          },
        },
      },
    },
  },
  domain: applicationDomainOf({ models: {} }),
}) as PostgresContract;

const title = ColumnRef.of('post', 'title');
const id = ColumnRef.of('post', 'id');

describe('Postgres adapter ORDER BY null placement', () => {
  const adapter = createPostgresAdapter();

  function selectOrderedBy(orderBy: ReadonlyArray<OrderByItem>): string {
    const ast = SelectAst.from(TableSource.named('post'))
      .withProjection([ProjectionItem.of('id', id)])
      .withOrderBy(orderBy);
    return adapter.lower(ast, { contract }).sql;
  }

  it('renders NULLS LAST and NULLS FIRST after the direction in a query ORDER BY', () => {
    expect(
      selectOrderedBy([
        OrderByItem.asc(title, { nulls: 'last' }),
        OrderByItem.desc(id, { nulls: 'first' }),
      ]),
    ).toBe(
      'SELECT "post"."id" AS "id" FROM "post" ORDER BY "post"."title" ASC NULLS LAST, "post"."id" DESC NULLS FIRST',
    );
  });

  it('renders no null placement when the order item has none', () => {
    expect(selectOrderedBy([OrderByItem.asc(title), OrderByItem.desc(id)])).toBe(
      'SELECT "post"."id" AS "id" FROM "post" ORDER BY "post"."title" ASC, "post"."id" DESC',
    );
  });

  it('renders null placement in a window ORDER BY', () => {
    const ast = SelectAst.from(TableSource.named('post')).withProjection([
      ProjectionItem.of(
        'rn',
        WindowFuncExpr.rowNumber({ orderBy: [OrderByItem.desc(title, { nulls: 'last' })] }),
      ),
    ]);

    expect(adapter.lower(ast, { contract }).sql).toBe(
      'SELECT ROW_NUMBER() OVER (ORDER BY "post"."title" DESC NULLS LAST) AS "rn" FROM "post"',
    );
  });

  it('renders null placement in an aggregate ORDER BY', () => {
    const ast = SelectAst.from(TableSource.named('post')).withProjection([
      ProjectionItem.of(
        'ids',
        JsonArrayAggExpr.of(new NativeJsonValueProjection(id), 'null', [
          OrderByItem.asc(title, { nulls: 'first' }),
        ]),
      ),
    ]);

    expect(adapter.lower(ast, { contract }).sql).toBe(
      'SELECT json_agg("post"."id" ORDER BY "post"."title" ASC NULLS FIRST) AS "ids" FROM "post"',
    );
  });
});
