import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  ExistsExpr,
  JoinAst,
  LiteralExpr,
  type ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { blindCast } from '@internal/utils/casts';
import { describe, expect, it } from 'vitest';
import { bindWhereExpr } from '../src/where-binding';

const DATA_TYPE_OF_CODEC: Readonly<Record<string, string>> = {
  'pg/int4@1': 'pg/int4',
  'pg/text@1': 'pg/text',
  'pg/varchar@1': 'pg/varchar',
};

function dataTypeOf(codecId: string): string {
  const dataType = DATA_TYPE_OF_CODEC[codecId];
  if (dataType === undefined) throw new Error(`no data type listed for codec ${codecId}`);
  return dataType;
}

function storageTable(columnCodecs: Record<string, string>) {
  const cols: Record<string, { codecId: string; dataType: string; nullable: boolean }> = {};
  for (const [column, codecId] of Object.entries(columnCodecs)) {
    cols[column] = { codecId, dataType: dataTypeOf(codecId), nullable: false };
  }
  return {
    columns: cols,
    primaryKey: { columns: ['id'] },
    uniques: [],
    indexes: [],
    foreignKeys: [],
  };
}

// The SAME bare table name `users` exists in both namespaces, each with a
// `token` column carrying a DIFFERENT codec. `public` is deliberately FIRST in
// `Object.keys(storage.namespaces)` so the first-match namespace scan in
// `createParamRef` resolves to `public` (the WRONG namespace) whenever the
// namespace coordinate is dropped on the recursive descent.
const twoNamespaceContract = blindCast<Contract<SqlStorage>, 'hand-built multi-namespace fixture'>({
  target: 'postgres',
  targetFamily: 'sql',
  capabilities: { returning: { enabled: true } },
  domain: {
    namespaces: {
      public: { models: {} },
      auth: { models: {} },
    },
  },
  storage: {
    storageHash: 'stub',
    namespaces: {
      public: {
        id: 'public',
        entries: { table: { users: storageTable({ id: 'pg/int4@1', token: 'pg/text@1' }) } },
      },
      auth: {
        id: 'auth',
        entries: { table: { users: storageTable({ id: 'pg/int4@1', token: 'pg/varchar@1' }) } },
      },
    },
  },
});

describe('bindWhereExpr nested-subquery namespace coordinate', () => {
  it('stamps the per-namespace codec on a param bound inside an EXISTS subquery targeting the second namespace', () => {
    // EXISTS subquery whose `from` is the SECOND namespace's `users` and whose
    // `where` carries a string literal on `users.token`. The literal must be
    // stamped with `auth.users.token` (pg/varchar@1), not the first-match
    // `public.users.token` (pg/text@1).
    const subquery = SelectAst.from(TableSource.named('users', undefined, 'auth'))
      .withProjection([ProjectionItem.of('token', ColumnRef.of('users', 'token'))])
      .withWhere(BinaryExpr.eq(ColumnRef.of('users', 'token'), LiteralExpr.of('secret')));

    const bound = bindWhereExpr(twoNamespaceContract, ExistsExpr.exists(subquery)) as ExistsExpr;

    const innerWhere = (bound.subquery as SelectAst).where as BinaryExpr;
    const param = innerWhere.right as ParamRef;
    expect(param.kind).toBe('param-ref');
    expect(param.value).toBe('secret');
    expect(param.codec).toEqual({ codecId: 'pg/varchar@1' });
  });

  it('stamps the per-namespace codec on a param bound inside a JOIN ON targeting the second namespace', () => {
    // A JOIN whose `source` is the SECOND namespace's `users` and whose `on`
    // filter carries a string literal on `users.token`. The literal must be
    // stamped with `auth.users.token` (pg/varchar@1), not the first-match
    // `public.users.token` (pg/text@1).
    const join = JoinAst.inner(
      TableSource.named('users', undefined, 'auth'),
      BinaryExpr.eq(ColumnRef.of('users', 'token'), LiteralExpr.of('secret')),
    );
    const query = SelectAst.from(TableSource.named('accounts', undefined, 'public'))
      .withProjection([ProjectionItem.of('token', ColumnRef.of('users', 'token'))])
      .withJoins([join]);

    const bound = bindWhereExpr(twoNamespaceContract, ExistsExpr.exists(query)) as ExistsExpr;

    const boundJoin = (bound.subquery as SelectAst).joins?.[0] as JoinAst;
    const onExpr = boundJoin.on as BinaryExpr;
    const param = onExpr.right as ParamRef;
    expect(param.kind).toBe('param-ref');
    expect(param.value).toBe('secret');
    expect(param.codec).toEqual({ codecId: 'pg/varchar@1' });
  });
});
