import {
  BinaryExpr,
  ColumnRef,
  type DeleteAst,
  type DoUpdateSetConflictAction,
  type InsertAst,
  ParamRef,
  ParamRef as ParamRefClass,
  type UpdateAst,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileDeleteCount,
  compileDeleteReturning,
  compileInsertCount,
  compileInsertCountSplit,
  compileInsertReturning,
  compileInsertReturningSplit,
  compileUpdateCount,
  compileUpdateReturning,
  compileUpsertReturning,
  compileUpsertReturningMany,
  compileUpsertReturningManySplit,
} from '../src/query-plan';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract } from './helpers';
import { unboundTables } from './unbound-tables';

function assertInsertAst(ast: unknown): asserts ast is InsertAst {
  expect((ast as { kind: string }).kind).toBe('insert');
}

function usersColParam(
  contract: ReturnType<typeof getTestContract>,
  column: string,
  value: unknown,
): ParamRef {
  const columns = unboundTables(contract.storage)['users']?.columns as
    | Record<string, { codecId?: string }>
    | undefined;
  const columnMeta = columns?.[column];
  return ParamRef.of(value, {
    name: column,
    codec: { codecId: columnMeta?.codecId ?? 'unknown' },
  });
}

describe('query plan mutations', () => {
  it('compileInsertReturning() batches rows with stable column order and DEFAULT cells', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileInsertReturning(
      contract,
      'public',
      'users',
      [
        { id: 10, name: 'Alice', email: 'alice@example.com' },
        { id: 11, name: 'Bob', email: 'bob@example.com', invited_by_id: 10 },
      ],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.params).toEqual([
      10,
      'Alice',
      'alice@example.com',
      11,
      'Bob',
      'bob@example.com',
      10,
    ]);
    expect(plan.ast.rows).toHaveLength(2);
    expect(plan.ast.rows[0]).toMatchObject({
      id: usersColParam(contract, 'id', 10),
      name: usersColParam(contract, 'name', 'Alice'),
      email: usersColParam(contract, 'email', 'alice@example.com'),
    });
    expect(plan.ast.rows[0]?.['invited_by_id']?.kind).toBe('default-value');
    expect(plan.ast.rows[1]).toMatchObject({
      id: usersColParam(contract, 'id', 11),
      name: usersColParam(contract, 'name', 'Bob'),
      email: usersColParam(contract, 'email', 'bob@example.com'),
      invited_by_id: usersColParam(contract, 'invited_by_id', 10),
    });
    expect(plan.ast.returning?.map((item) => item.alias)).toEqual([
      'address',
      'email',
      'id',
      'invited_by_id',
      'name',
    ]);
    expect(plan.ast.returning?.every((item) => item.expr.kind === 'column-ref')).toBe(true);
  });

  it('compileInsertCount() keeps explicit empty rows for all-default batch inserts', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(contract, 'public', 'users', [{}, {}]);

    assertInsertAst(plan.ast);
    expect(plan.params).toEqual([]);
    expect(plan.ast.rows).toEqual([{}, {}]);
  });

  it('compileUpsertReturning() uses DO NOTHING and default returning columns when update is empty', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileUpsertReturning(
      contract,
      'public',
      'users',
      { id: 10, name: 'Alice', email: 'alice@example.com' },
      {},
      ['email'],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.action?.kind).toBe('do-nothing');
    expect(plan.params).toEqual([10, 'Alice', 'alice@example.com']);
    expect(plan.ast.returning?.map((item) => item.alias)).toEqual(
      Object.keys(unboundTables(contract.storage)['users']!.columns),
    );
  });

  it('compileInsertReturning() rejects empty rows array', () => {
    const contract = withReturningCapability(getTestContract());

    expect(() => compileInsertReturning(contract, 'public', 'users', [], undefined)).toThrow(
      'at least one row',
    );
  });

  it('compileInsertCount() rejects empty rows array', () => {
    const contract = getTestContract();

    expect(() => compileInsertCount(contract, 'public', 'users', [])).toThrow('at least one row');
  });

  it('compileUpsertReturning() produces DoUpdateSetConflictAction with correct params when update is non-empty', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileUpsertReturning(
      contract,
      'public',
      'users',
      { id: 10, name: 'Alice', email: 'alice@example.com' },
      { name: 'Updated Alice' },
      ['email'],
      undefined,
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.action?.kind).toBe('do-update-set');
    const action = plan.ast.onConflict?.action as DoUpdateSetConflictAction;
    expect(action.set).toEqual({
      name: usersColParam(contract, 'name', 'Updated Alice'),
    });
    expect(plan.params).toEqual([10, 'Alice', 'alice@example.com', 'Updated Alice']);
  });

  describe('compileUpsertReturningMany()', () => {
    it('assigns every update column from the excluded row across a batched insert', () => {
      const contract = withReturningCapability(getTestContract());
      const plan = compileUpsertReturningMany(
        contract,
        'public',
        'users',
        [
          { id: 10, name: 'Alice', email: 'alice@example.com' },
          { id: 11, name: 'Bob', email: 'bob@example.com' },
        ],
        { columns: ['id'], updateColumns: ['name', 'email'], updateDefaults: {} },
        undefined,
      );

      assertInsertAst(plan.ast);
      expect(plan.ast.rows).toHaveLength(2);
      expect(plan.ast.onConflict?.columns).toEqual([ColumnRef.of('users', 'id')]);
      const action = plan.ast.onConflict?.action as DoUpdateSetConflictAction;
      expect(action.set).toEqual({
        name: ColumnRef.of('excluded', 'name'),
        email: ColumnRef.of('excluded', 'email'),
      });
      // The excluded assignments bind nothing — only the VALUES rows carry params.
      expect(plan.params).toEqual([10, 'Alice', 'alice@example.com', 11, 'Bob', 'bob@example.com']);
    });

    it('binds update defaults as literal params beside the excluded assignments', () => {
      const contract = withReturningCapability(getTestContract());
      const plan = compileUpsertReturningMany(
        contract,
        'public',
        'users',
        [{ id: 10, name: 'Alice', email: 'alice@example.com' }],
        {
          columns: ['id'],
          updateColumns: ['name'],
          updateDefaults: { address: 'generated address' },
        },
        undefined,
      );

      assertInsertAst(plan.ast);
      const action = plan.ast.onConflict?.action as DoUpdateSetConflictAction;
      expect(action.set).toEqual({
        name: ColumnRef.of('excluded', 'name'),
        address: usersColParam(contract, 'address', 'generated address'),
      });
      expect(plan.params).toEqual([10, 'Alice', 'alice@example.com', 'generated address']);
    });

    it('lets an update default win over the excluded assignment for the same column', () => {
      const contract = withReturningCapability(getTestContract());
      const plan = compileUpsertReturningMany(
        contract,
        'public',
        'users',
        [{ id: 10, name: 'Alice', email: 'alice@example.com', address: 'Old St' }],
        {
          columns: ['id'],
          updateColumns: ['name', 'address'],
          updateDefaults: { address: 'generated address' },
        },
        undefined,
      );

      assertInsertAst(plan.ast);
      const action = plan.ast.onConflict?.action as DoUpdateSetConflictAction;
      expect(action.set).toEqual({
        name: ColumnRef.of('excluded', 'name'),
        address: usersColParam(contract, 'address', 'generated address'),
      });
    });

    it('uses DO NOTHING when no update columns and no update defaults remain', () => {
      const contract = withReturningCapability(getTestContract());
      const plan = compileUpsertReturningMany(
        contract,
        'public',
        'users',
        [{ id: 10, name: 'Alice', email: 'alice@example.com' }],
        { columns: ['id'], updateColumns: [], updateDefaults: {} },
        undefined,
      );

      assertInsertAst(plan.ast);
      expect(plan.ast.onConflict?.action?.kind).toBe('do-nothing');
      expect(plan.ast.returning?.map((item) => item.alias)).toEqual(
        Object.keys(unboundTables(contract.storage)['users']!.columns),
      );
    });

    it('rejects an empty rows array', () => {
      const contract = withReturningCapability(getTestContract());
      expect(() =>
        compileUpsertReturningMany(
          contract,
          'public',
          'users',
          [],
          { columns: ['id'], updateColumns: ['name'], updateDefaults: {} },
          undefined,
        ),
      ).toThrow('at least one row');
    });
  });

  describe('compileUpsertReturningManySplit()', () => {
    it('keeps one update set across the per-column-signature groups', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileUpsertReturningManySplit(
        contract,
        'public',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com', address: 'Baker St' },
        ],
        { columns: ['id'], updateColumns: ['name', 'email', 'address'], updateDefaults: {} },
        undefined,
      );

      expect(plans).toHaveLength(2);
      for (const plan of plans) {
        assertInsertAst(plan.ast);
        const action = plan.ast.onConflict?.action as DoUpdateSetConflictAction;
        expect(action.set).toEqual({
          name: ColumnRef.of('excluded', 'name'),
          email: ColumnRef.of('excluded', 'email'),
          address: ColumnRef.of('excluded', 'address'),
        });
      }
    });
  });

  describe('compileInsertReturningSplit()', () => {
    it('produces a single plan when all rows have the same columns', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
    });

    it('splits rows with different column sets into separate plans', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
        ],
        undefined,
      );
      expect(plans).toHaveLength(2);
      assertInsertAst(plans[0]!.ast);
      assertInsertAst(plans[1]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(1);
      expect(plans[1]!.ast.rows).toHaveLength(1);
    });

    it('preserves input order: non-adjacent rows with same signature produce separate groups', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
          { id: 3, name: 'Charlie', email: 'c@c.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(3);
    });

    it('groups adjacent rows with identical columns together', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com' },
          { id: 2, name: 'Bob', email: 'b@b.com' },
          { id: 3, name: 'Charlie', email: 'c@c.com', invited_by_id: 1 },
          { id: 4, name: 'Diana', email: 'd@d.com', invited_by_id: 2 },
        ],
        undefined,
      );
      expect(plans).toHaveLength(2);
      assertInsertAst(plans[0]!.ast);
      assertInsertAst(plans[1]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
      expect(plans[1]!.ast.rows).toHaveLength(2);
    });

    it('treats undefined values as absent columns', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'users',
        [
          { id: 1, name: 'Alice', email: 'a@a.com', invited_by_id: undefined },
          { id: 2, name: 'Bob', email: 'b@b.com' },
        ],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(2);
    });

    it('handles a single row', () => {
      const contract = withReturningCapability(getTestContract());
      const plans = compileInsertReturningSplit(
        contract,
        'public',
        'users',
        [{ id: 1, name: 'Alice', email: 'a@a.com' }],
        undefined,
      );
      expect(plans).toHaveLength(1);
      assertInsertAst(plans[0]!.ast);
      expect(plans[0]!.ast.rows).toHaveLength(1);
    });
  });

  describe('compileInsertCountSplit()', () => {
    it('produces a single plan when all rows have the same columns', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'public', 'users', [
        { id: 1, name: 'Alice', email: 'a@a.com' },
        { id: 2, name: 'Bob', email: 'b@b.com' },
      ]);
      expect(plans).toHaveLength(1);
    });

    it('splits rows with different column sets', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'public', 'users', [
        { id: 1, name: 'Alice', email: 'a@a.com' },
        { id: 2, name: 'Bob', email: 'b@b.com', invited_by_id: 1 },
      ]);
      expect(plans).toHaveLength(2);
    });

    it('preserves input order over minimizing group count', () => {
      const contract = getTestContract();
      const plans = compileInsertCountSplit(contract, 'public', 'users', [
        { id: 1, name: 'A', email: 'a@a.com' },
        { id: 2, name: 'B', email: 'b@b.com', invited_by_id: 1 },
        { id: 3, name: 'C', email: 'c@c.com' },
      ]);
      expect(plans).toHaveLength(3);
    });
  });

  it('compileUpdateCount() and compileDeleteCount() omit WHERE when filters are empty', () => {
    const contract = getTestContract();

    const updatePlan = compileUpdateCount(contract, 'public', 'users', { name: 'Alice' }, []);
    expect(updatePlan.ast.kind).toBe('update');
    expect((updatePlan.ast as UpdateAst).where).toBeUndefined();
    expect(updatePlan.params).toEqual(['Alice']);

    const deletePlan = compileDeleteCount(contract, 'public', 'users', []);
    expect(deletePlan.ast.kind).toBe('delete');
    expect((deletePlan.ast as DeleteAst).where).toBeUndefined();
    expect(deletePlan.params).toEqual([]);
  });

  describe('split helpers reject empty rows', () => {
    it('compileInsertReturningSplit() rejects an empty rows array', () => {
      const contract = withReturningCapability(getTestContract());
      expect(() =>
        compileInsertReturningSplit(contract, 'public', 'users', [], undefined),
      ).toThrowError(/at least one row/);
    });

    it('compileInsertCountSplit() rejects an empty rows array', () => {
      const contract = getTestContract();
      expect(() => compileInsertCountSplit(contract, 'public', 'users', [])).toThrowError(
        /at least one row/,
      );
    });
  });

  describe('UPDATE / DELETE WHERE preservation', () => {
    function eqOnUserId(value: number) {
      return BinaryExpr.eq(
        ColumnRef.of('users', 'id'),
        ParamRefClass.of(value, {
          name: 'id',
          codec: { codecId: 'pg/int4@1' },
        }),
      );
    }

    it('compileUpdateReturning() preserves WHERE when filters are present', () => {
      const contract = withReturningCapability(getTestContract());
      const plan = compileUpdateReturning(
        contract,
        'public',
        'users',
        { name: 'Alice' },
        [eqOnUserId(7)],
        undefined,
      );
      expect(plan.ast.kind).toBe('update');
      expect((plan.ast as UpdateAst).where).toBeDefined();
      expect(plan.params).toEqual(['Alice', 7]);
    });

    it('compileUpdateCount() preserves WHERE when filters are present', () => {
      const contract = getTestContract();
      const plan = compileUpdateCount(contract, 'public', 'users', { name: 'Bob' }, [
        eqOnUserId(9),
      ]);
      expect((plan.ast as UpdateAst).where).toBeDefined();
      expect(plan.params).toEqual(['Bob', 9]);
    });

    it('compileDeleteReturning() preserves WHERE when filters are present and omits when empty', () => {
      const contract = withReturningCapability(getTestContract());
      const planWithWhere = compileDeleteReturning(
        contract,
        'public',
        'users',
        [eqOnUserId(3)],
        undefined,
      );
      expect((planWithWhere.ast as DeleteAst).where).toBeDefined();
      expect(planWithWhere.params).toEqual([3]);

      const planNoWhere = compileDeleteReturning(contract, 'public', 'users', [], undefined);
      expect((planNoWhere.ast as DeleteAst).where).toBeUndefined();
      expect(planNoWhere.params).toEqual([]);
    });
  });

  describe('table/column resolution errors', () => {
    it('compileUpdateCount() rejects an unknown table', () => {
      const contract = getTestContract();
      expect(() =>
        compileUpdateCount(contract, 'public', 'missing_table', { name: 'X' }, []),
      ).toThrowError(/Unknown table "missing_table"/);
    });

    it('compileUpdateCount() rejects an unknown column for the table', () => {
      const contract = getTestContract();
      expect(() =>
        compileUpdateCount(contract, 'public', 'users', { not_a_real_column: 'X' }, []),
      ).toThrowError(/Unknown column "not_a_real_column" in table "users"/);
    });

    it('compileInsertCount() rejects an unknown table', () => {
      const contract = getTestContract();
      expect(() =>
        compileInsertCount(contract, 'public', 'missing_table', [{ id: 1 }]),
      ).toThrowError(/Unknown table "missing_table"/);
    });

    it('compileInsertCount() rejects an unknown column on an insert row', () => {
      const contract = getTestContract();
      expect(() =>
        compileInsertCount(contract, 'public', 'users', [{ id: 1, not_a_real_column: 'X' }]),
      ).toThrowError(/Unknown column "not_a_real_column" in table "users"/);
    });
  });
});
