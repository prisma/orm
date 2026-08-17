import {
  ColumnRef,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  RawExpr,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { postgresCodecDescriptorRegistry } from '@internal/target-postgres/codecs';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { renderLoweredSql } from '../src/core/sql-renderer';
import type { PostgresContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'postgres',
  targetFamily: 'sql',
  profileHash: 'raw-expr-test',
  roots: {},
  capabilities: {},
  extensions: {},
  meta: {},
  storage: {
    storageHash: 'raw-expr-core',
    namespaces: {
      __unbound__: {
        id: '__unbound__',
        entries: {
          table: {
            user: {
              columns: {
                id: { codecId: 'pg/int4@1', nativeType: 'int4', nullable: false },
                email: { codecId: 'pg/text@1', nativeType: 'text', nullable: false },
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

function selectWithWhere(whereExpr: import('@internal/sql-relational-core/ast').AnyExpression) {
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(whereExpr);
}

describe('RawExpr postgres lowering', () => {
  it('lowers a zero-interpolation RawExpr to a verbatim SQL fragment', () => {
    // A zero-interpolation RawExpr renders verbatim, so nothing ever resolves this codec — the id
    // is declared metadata only. Naming a fictional one keeps that visible: were the lowering to
    // start resolving it, this would fail loudly rather than quietly agree with a real codec.
    const rawExpr = new RawExpr({
      parts: ['now()'],
      returns: { codecId: 'test/never-resolved@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toContain('now()');
    expect(lowered.params).toHaveLength(0);
  });

  it('lowers a RawExpr with a string part and a ParamRef expression part using positional $N placeholders', () => {
    const paramRef = ParamRef.of(42, { name: 'score', codec: { codecId: 'pg/int4@1' } });
    const rawExpr = new RawExpr({
      parts: ['score > ', paramRef],
      returns: { codecId: 'pg/bool@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toContain('score > $1');
    expect(lowered.params).toHaveLength(1);
    expect(lowered.params[0]).toEqual({ kind: 'literal', value: 42 });
  });

  it('lowers multiple ParamRef elements with sequential positional indices', () => {
    const ref1 = ParamRef.of(1, { name: 'minId', codec: { codecId: 'pg/int4@1' } });
    const ref2 = ParamRef.of(100, { name: 'maxId', codec: { codecId: 'pg/int4@1' } });
    const rawExpr = new RawExpr({
      parts: ['id BETWEEN ', ref1, ' AND ', ref2],
      returns: { codecId: 'pg/bool@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toContain('id BETWEEN $1 AND $2');
    expect(lowered.params).toHaveLength(2);
    expect(lowered.params[0]).toEqual({ kind: 'literal', value: 1 });
    expect(lowered.params[1]).toEqual({ kind: 'literal', value: 100 });
  });

  it('lowers back-to-back interpolations with empty string parts as no-ops', () => {
    const ref1 = ParamRef.of(1, { name: 'a', codec: { codecId: 'pg/int4@1' } });
    const ref2 = ParamRef.of(2, { name: 'b', codec: { codecId: 'pg/int4@1' } });
    const rawExpr = new RawExpr({
      parts: ['', ref1, '', ref2, ''],
      returns: { codecId: 'pg/bool@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toContain('$1$2');
    expect(lowered.params).toHaveLength(2);
  });

  it('lowers a RawExpr with a nested expression (column ref) as a part', () => {
    const columnRef = ColumnRef.of('user', 'id');
    const rawExpr = new RawExpr({
      parts: ['LENGTH(', columnRef, ') > 0'],
      returns: { codecId: 'pg/bool@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toContain('LENGTH("user"."id") > 0');
  });

  it('lowers a RawExpr with a LiteralExpr element as a part', () => {
    const litExpr = LiteralExpr.of('active');
    const rawExpr = new RawExpr({
      parts: ['status = ', litExpr],
      returns: { codecId: 'pg/bool@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, postgresCodecDescriptorRegistry);

    expect(lowered.sql).toContain("status = 'active'");
    expect(lowered.params).toHaveLength(0);
  });
});
