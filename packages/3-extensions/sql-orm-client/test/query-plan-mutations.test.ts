import {
  BinaryExpr,
  ColumnRef,
  type DeleteAst,
  type InsertAst,
  ParamRef,
  ParamRef as ParamRefClass,
  type UpdateAst,
} from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import {
  compileDeleteCount,
  compileInsertCount,
  compileInsertReturning,
  compileUpdateCount,
  compileUpdateReturning,
} from '../src/query-plan';
import { groupRowsByColumnSignature } from '../src/query-plan-mutations';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract, tablesForTable } from './helpers';
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
      'User',
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

  it('compileInsertCount() attaches a targetless DO NOTHING clause when asked to skip conflicts', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(
      contract,
      'public',
      'users',
      [{ id: 10, name: 'Alice', email: 'alice@example.com' }],
      { columns: [] },
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.columns).toEqual([]);
    expect(plan.ast.onConflict?.action.kind).toBe('do-nothing');
  });

  it('compileInsertCount() targets the named columns when asked to skip conflicts on them', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(
      contract,
      'public',
      'users',
      [{ id: 10, name: 'Alice', email: 'alice@example.com' }],
      { columns: ['email'] },
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.columns).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.ast.onConflict?.action.kind).toBe('do-nothing');
  });

  it('compileInsertCount() leaves the clause off when not asked to skip conflicts', () => {
    const contract = getTestContract();
    const plan = compileInsertCount(contract, 'public', 'users', [
      { id: 10, name: 'Alice', email: 'alice@example.com' },
    ]);

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict).toBeUndefined();
  });

  it('compileInsertReturning() attaches the skip clause alongside RETURNING', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = compileInsertReturning(
      contract,
      'public',
      'User',
      'users',
      [{ id: 10, name: 'Alice', email: 'alice@example.com' }],
      ['id'],
      { columns: ['email'] },
    );

    assertInsertAst(plan.ast);
    expect(plan.ast.onConflict?.columns).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.ast.onConflict?.action.kind).toBe('do-nothing');
    expect(plan.ast.returning).toHaveLength(1);
  });

  it('compileInsertReturning() rejects empty rows array', () => {
    const contract = withReturningCapability(getTestContract());

    expect(() =>
      compileInsertReturning(contract, 'public', 'User', 'users', [], undefined),
    ).toThrow('at least one row');
  });

  it('compileInsertCount() rejects empty rows array', () => {
    const contract = getTestContract();

    expect(() => compileInsertCount(contract, 'public', 'users', [])).toThrow('at least one row');
  });

  describe('groupRowsByColumnSignature()', () => {
    const alice = { id: 1, name: 'Alice', email: 'a@a.com' };
    const bob = { id: 2, name: 'Bob', email: 'b@b.com' };
    const invitedCarol = { id: 3, name: 'Carol', email: 'c@c.com', invited_by_id: 1 };
    const invitedDiana = { id: 4, name: 'Diana', email: 'd@d.com', invited_by_id: 2 };

    it('keeps rows that set the same columns in one group', () => {
      expect(groupRowsByColumnSignature([alice, bob])).toEqual([[alice, bob]]);
    });

    it('starts a new group where the set of columns changes, in input order', () => {
      expect(groupRowsByColumnSignature([alice, invitedCarol, bob])).toEqual([
        [alice],
        [invitedCarol],
        [bob],
      ]);
    });

    it('groups adjacent rows with identical columns together', () => {
      expect(groupRowsByColumnSignature([alice, bob, invitedCarol, invitedDiana])).toEqual([
        [alice, bob],
        [invitedCarol, invitedDiana],
      ]);
    });

    it('treats undefined values as absent columns', () => {
      expect(groupRowsByColumnSignature([{ ...alice, invited_by_id: undefined }, bob])).toEqual([
        [alice, bob],
      ]);
    });
  });

  it('compileUpdateCount() and compileDeleteCount() omit WHERE when filters are empty', () => {
    const contract = getTestContract();

    const updatePlan = compileUpdateCount(
      contract,
      tablesForTable(contract, 'users', 'public'),
      { name: 'Alice' },
      [],
    );
    expect(updatePlan.ast.kind).toBe('update');
    expect((updatePlan.ast as UpdateAst).where).toBeUndefined();
    expect(updatePlan.params).toEqual(['Alice']);

    const deletePlan = compileDeleteCount(
      contract,
      tablesForTable(contract, 'users', 'public'),
      [],
    );
    expect(deletePlan.ast.kind).toBe('delete');
    expect((deletePlan.ast as DeleteAst).where).toBeUndefined();
    expect(deletePlan.params).toEqual([]);
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
        'User',
        tablesForTable(contract, 'users', 'public'),
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
      const plan = compileUpdateCount(
        contract,
        tablesForTable(contract, 'users', 'public'),
        { name: 'Bob' },
        [eqOnUserId(9)],
      );
      expect((plan.ast as UpdateAst).where).toBeDefined();
      expect(plan.params).toEqual(['Bob', 9]);
    });
  });

  describe('table/column resolution errors', () => {
    it('compileUpdateCount() rejects an unknown table', () => {
      const contract = getTestContract();
      expect(() =>
        compileUpdateCount(
          contract,
          tablesForTable(contract, 'missing_table', 'public'),
          { name: 'X' },
          [],
        ),
      ).toThrowError(/Unknown table "missing_table"/);
    });

    it('compileUpdateCount() rejects an unknown column for the table', () => {
      const contract = getTestContract();
      expect(() =>
        compileUpdateCount(
          contract,
          tablesForTable(contract, 'users', 'public'),
          { not_a_real_column: 'X' },
          [],
        ),
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
