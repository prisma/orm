import {
  BinaryExpr,
  ColumnRef,
  ParamRef,
  type ToWhereExpr,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { normalizeWhereArg } from '../src/where-interop';

const col = (table: string, column: string) => ColumnRef.of(table, column);
const param = (value: unknown, name: string) =>
  ParamRef.of(value, { name, codec: { codecId: 'pg/text@1' } });

describe('where interop', () => {
  it('rejects null where args', () => {
    expect(() => normalizeWhereArg(null as unknown as ToWhereExpr)).toThrow(/cannot be null/i);
  });

  it('normalizes ToWhereExpr to expr only', () => {
    const expr = BinaryExpr.eq(col('users', 'name'), param('Alice', 'name'));
    const arg = {
      toWhereExpr: () => expr,
    } satisfies ToWhereExpr;

    expect(normalizeWhereArg(arg)).toEqual(expr);
  });
});
