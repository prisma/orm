import {
  ColumnRef,
  LiteralExpr,
  ParamRef,
  ProjectionItem,
  RawExpr,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { sqliteCodecDescriptorRegistry } from '@internal/target-sqlite/codecs';
import { applicationDomainOf } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { TestSqlContractSerializer as SqlContractSerializer } from '../../../../2-sql/9-family/test/test-sql-contract-serializer';
import { renderLoweredSql } from '../src/core/adapter';
import type { SqliteContract } from '../src/core/types';

const contract = new SqlContractSerializer().deserializeContract({
  target: 'sqlite',
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
                id: { codecId: 'sqlite/integer@1', dataType: 'sqlite/integer', nullable: false },
                email: { codecId: 'sqlite/text@1', dataType: 'sqlite/text', nullable: false },
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
}) as SqliteContract;

function selectWithWhere(whereExpr: import('@internal/sql-relational-core/ast').AnyExpression) {
  return SelectAst.from(TableSource.named('user'))
    .withProjection([ProjectionItem.of('id', ColumnRef.of('user', 'id'))])
    .withWhere(whereExpr);
}

describe('RawExpr sqlite lowering', () => {
  it('lowers a zero-interpolation RawExpr to a verbatim SQL fragment', () => {
    const rawExpr = new RawExpr({
      parts: ['datetime("now")'],
      returns: { codecId: 'sqlite/text@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);

    expect(lowered.sql).toContain('datetime("now")');
    expect(lowered.params).toHaveLength(0);
  });

  it('lowers a RawExpr with a string part and a ParamRef element using ? placeholders', () => {
    const paramRef = ParamRef.of(42, { name: 'score', codec: { codecId: 'sqlite/integer@1' } });
    const rawExpr = new RawExpr({
      parts: ['score > ', paramRef],
      returns: { codecId: 'sqlite/integer@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);

    expect(lowered.sql).toContain('score > ?');
    expect(lowered.params).toHaveLength(1);
    expect(lowered.params[0]).toEqual({ kind: 'literal', value: 42 });
  });

  it('lowers multiple ParamRef elements each rendered as ?', () => {
    const ref1 = ParamRef.of(1, { name: 'minId', codec: { codecId: 'sqlite/integer@1' } });
    const ref2 = ParamRef.of(100, { name: 'maxId', codec: { codecId: 'sqlite/integer@1' } });
    const rawExpr = new RawExpr({
      parts: ['id BETWEEN ', ref1, ' AND ', ref2],
      returns: { codecId: 'sqlite/integer@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);

    expect(lowered.sql).toContain('id BETWEEN ? AND ?');
    expect(lowered.params).toHaveLength(2);
    expect(lowered.params[0]).toEqual({ kind: 'literal', value: 1 });
    expect(lowered.params[1]).toEqual({ kind: 'literal', value: 100 });
  });

  it('lowers back-to-back interpolations with empty string parts as no-ops', () => {
    const ref1 = ParamRef.of(1, { name: 'a', codec: { codecId: 'sqlite/integer@1' } });
    const ref2 = ParamRef.of(2, { name: 'b', codec: { codecId: 'sqlite/integer@1' } });
    const rawExpr = new RawExpr({
      parts: ['', ref1, '', ref2, ''],
      returns: { codecId: 'sqlite/integer@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);

    expect(lowered.sql).toContain('??');
    expect(lowered.params).toHaveLength(2);
  });

  it('lowers a RawExpr with a nested column ref element as a part', () => {
    const columnRef = ColumnRef.of('user', 'id');
    const rawExpr = new RawExpr({
      parts: ['LENGTH(CAST(', columnRef, ' AS TEXT)) > 0'],
      returns: { codecId: 'sqlite/integer@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);

    expect(lowered.sql).toContain('LENGTH(CAST("user"."id" AS TEXT)) > 0');
  });

  it('lowers a RawExpr with a LiteralExpr element as a part', () => {
    const litExpr = LiteralExpr.of('active');
    const rawExpr = new RawExpr({
      parts: ['status = ', litExpr],
      returns: { codecId: 'sqlite/text@1', nullable: false },
    });

    const ast = selectWithWhere(rawExpr);
    const lowered = renderLoweredSql(ast, contract, sqliteCodecDescriptorRegistry);

    expect(lowered.sql).toContain("status = 'active'");
    expect(lowered.params).toHaveLength(0);
  });
});
