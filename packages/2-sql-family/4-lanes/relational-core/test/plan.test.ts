import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import { RawQueryAst } from '../src/exports/ast';
import { planFromAst } from '../src/plan';

const CONTRACT = {
  target: 'postgres',
  targetFamily: 'sql',
  storage: { storageHash: 'test-storage' },
} as unknown as Contract<SqlStorage>;

describe('planFromAst', () => {
  it('wraps the AST in a SqlQueryPlan whose meta is sourced from the contract', () => {
    const ast = RawQueryAst.rows(['select 1'], { one: { codecId: 'pg/int4@1', nullable: false } });
    const plan = planFromAst(ast, CONTRACT);

    expect(plan.ast).toBe(ast);
    expect(plan.params).toEqual([]);
    expect(plan.meta).toEqual({
      target: 'postgres',
      targetFamily: 'sql',
      storageHash: 'test-storage',
      lane: 'raw',
    });
  });

  it('honours an explicit laneId override', () => {
    const ast = RawQueryAst.rows(['select 1'], { one: { codecId: 'pg/int4@1', nullable: false } });
    const plan = planFromAst(ast, CONTRACT, 'cipherstash:migration');

    expect(plan.meta.lane).toBe('cipherstash:migration');
  });
});
