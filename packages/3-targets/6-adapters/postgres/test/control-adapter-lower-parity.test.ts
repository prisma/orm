import {
  type AnyQueryAst,
  BinaryExpr,
  ColumnRef,
  DefaultValueExpr,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
  UpdateAst,
} from '@internal/sql-relational-core/ast';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import type { PostgresContract } from '../src/core/types';
import {
  createComposedPostgresAdapter,
  createComposedPostgresControlAdapter,
} from './helpers/composed-adapter';

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
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', dataType: 'pg/int4', nullable: false },
                email: { codecId: 'pg/text@1', dataType: 'pg/text', nullable: false },
                profile: { codecId: 'pg/jsonb@1', dataType: 'pg/jsonb', nullable: true },
                settings: { codecId: 'pg/json@1', dataType: 'pg/json', nullable: true },
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

const runtimeAdapter = createComposedPostgresAdapter({ extensions: [] });
const controlAdapter = createComposedPostgresControlAdapter({ extensions: [] });

function expectParity(ast: AnyQueryAst): void {
  const runtime = runtimeAdapter.lower(ast, { contract });
  const control = controlAdapter.lower(ast, { contract });
  expect(control).toEqual(runtime);
}

describe('PostgresControlAdapter.lower / PostgresAdapterImpl.lower parity', () => {
  it('matches on simple SELECT with literal WHERE', () => {
    const ast = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('user', 'email'), LiteralExpr.of('a@example.com')));
    expectParity(ast);
  });

  it('matches on INSERT with ON CONFLICT and RETURNING', () => {
    const ast = InsertAst.into(TableSource.named('user'))
      .withRows([
        {
          id: ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
          email: ParamRef.of('a@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
        },
        {
          id: ParamRef.of(2, { name: 'id2', codec: { codecId: 'pg/int4@1' } }),
          email: new DefaultValueExpr(),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([ColumnRef.of('user', 'email')]).doUpdateSet({
          email: ColumnRef.of('excluded', 'email'),
        }),
      )
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);
    expectParity(ast);
  });

  it('matches on UPDATE with parameterized WHERE', () => {
    const ast = UpdateAst.table(TableSource.named('user'))
      .withSet({
        email: ParamRef.of('b@example.com', { name: 'email', codec: { codecId: 'pg/text@1' } }),
      })
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      )
      .withReturning([ProjectionItem.of('email', ColumnRef.of('user', 'email'))]);
    expectParity(ast);
  });

  it('matches on DELETE with RETURNING', () => {
    const ast = DeleteAst.from(TableSource.named('user'))
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'id'),
          ParamRef.of(1, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
        ),
      )
      .withReturning([ProjectionItem.of('id', ColumnRef.of('user', 'id'))]);
    expectParity(ast);
  });

  it('matches on JSON and JSONB ParamRef casts', () => {
    const jsonbAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'profile'),
          ParamRef.of({ active: true }, { name: 'profile', codec: { codecId: 'pg/jsonb@1' } }),
        ),
      );
    const jsonAst = SelectAst.from(TableSource.named('user'))
      .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
      .withWhere(
        BinaryExpr.eq(
          ColumnRef.of('user', 'settings'),
          ParamRef.of({ darkMode: true }, { name: 'settings', codec: { codecId: 'pg/json@1' } }),
        ),
      );
    expectParity(jsonbAst);
    expectParity(jsonAst);

    expect(runtimeAdapter.lower(jsonbAst, { contract }).sql).toContain('::jsonb');
    expect(runtimeAdapter.lower(jsonAst, { contract }).sql).toContain('::json');
  });
});
