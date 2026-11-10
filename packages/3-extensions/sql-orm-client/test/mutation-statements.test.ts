import { BinaryExpr, ColumnRef, type InsertAst, ParamRef } from '@internal/sql-relational-core/ast';
import { describe, expect, it } from 'vitest';
import { createStatementTables } from '../src/collection-tables';
import {
  countMutationWhere,
  deleteAst,
  groupRowsByColumnSignature,
  type InsertConflictSkip,
  insertAst,
  returningProjection,
  updateAst,
} from '../src/mutation-statements';
import { combineWhereExprs } from '../src/where-utils';
import { withReturningCapability } from './collection-fixtures';
import { getTestContract, tablesForTable } from './helpers';
import { unboundTables } from './unbound-tables';

const usersTable = createStatementTables({ namespaceId: 'public', tableName: 'users' }).root;

function insertUsers(
  contract: ReturnType<typeof getTestContract>,
  rows: readonly Record<string, unknown>[],
  conflict?: InsertConflictSkip,
): InsertAst {
  return insertAst(contract, usersTable, rows, conflict);
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

describe('mutation statements', () => {
  it('batches insert rows with stable column order and DEFAULT cells', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = insertUsers(contract, [
      { id: 10, name: 'Alice', email: 'alice@example.com' },
      { id: 11, name: 'Bob', email: 'bob@example.com', invited_by_id: 10 },
    ]).withReturning(returningProjection(contract, 'User', usersTable, undefined));

    expect(plan.rows).toHaveLength(2);
    expect(plan.rows[0]).toMatchObject({
      id: usersColParam(contract, 'id', 10),
      name: usersColParam(contract, 'name', 'Alice'),
      email: usersColParam(contract, 'email', 'alice@example.com'),
    });
    expect(plan.rows[0]?.['invited_by_id']?.kind).toBe('default-value');
    expect(plan.rows[1]).toMatchObject({
      id: usersColParam(contract, 'id', 11),
      name: usersColParam(contract, 'name', 'Bob'),
      email: usersColParam(contract, 'email', 'bob@example.com'),
      invited_by_id: usersColParam(contract, 'invited_by_id', 10),
    });
    expect(plan.returning?.map((item) => item.alias)).toEqual([
      'address',
      'email',
      'id',
      'invited_by_id',
      'name',
    ]);
    expect(plan.returning?.every((item) => item.expr.kind === 'column-ref')).toBe(true);
  });

  it('keeps explicit empty rows for all-default batch inserts', () => {
    const contract = getTestContract();
    const plan = insertUsers(contract, [{}, {}]);

    expect(plan.rows).toEqual([{}, {}]);
  });

  it('attaches a targetless DO NOTHING clause when asked to skip conflicts', () => {
    const contract = getTestContract();
    const plan = insertUsers(contract, [{ id: 10, name: 'Alice', email: 'alice@example.com' }], {
      columns: [],
    });

    expect(plan.onConflict?.columns).toEqual([]);
    expect(plan.onConflict?.action.kind).toBe('do-nothing');
  });

  it('targets the named columns when asked to skip conflicts on them', () => {
    const contract = getTestContract();
    const plan = insertUsers(contract, [{ id: 10, name: 'Alice', email: 'alice@example.com' }], {
      columns: ['email'],
    });

    expect(plan.onConflict?.columns).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.onConflict?.action.kind).toBe('do-nothing');
  });

  it('leaves the clause off when not asked to skip conflicts', () => {
    const contract = getTestContract();
    const plan = insertUsers(contract, [{ id: 10, name: 'Alice', email: 'alice@example.com' }]);

    expect(plan.onConflict).toBeUndefined();
  });

  it('keeps the skip clause alongside RETURNING', () => {
    const contract = withReturningCapability(getTestContract());
    const plan = insertUsers(contract, [{ id: 10, name: 'Alice', email: 'alice@example.com' }], {
      columns: ['email'],
    }).withReturning(returningProjection(contract, 'User', usersTable, ['id']));

    expect(plan.onConflict?.columns).toEqual([ColumnRef.of('users', 'email')]);
    expect(plan.onConflict?.action.kind).toBe('do-nothing');
    expect(plan.returning).toHaveLength(1);
  });

  it('rejects an insert with no rows', () => {
    const contract = getTestContract();

    expect(() => insertUsers(contract, [])).toThrow('at least one row');
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

  it('builds an update and a delete without where when there are no filters', () => {
    const contract = getTestContract();
    const tables = tablesForTable(contract, 'users', 'public');
    const where = countMutationWhere(contract, tables, [], undefined);

    expect(updateAst(contract, tables, { name: 'Alice' }, where).where).toBeUndefined();
    expect(deleteAst(contract, tables, where).where).toBeUndefined();
  });

  it('keeps the filters as the where of an update', () => {
    const contract = getTestContract();
    const tables = tablesForTable(contract, 'users', 'public');
    const byId = BinaryExpr.eq(
      ColumnRef.of('users', 'id'),
      ParamRef.of(7, { name: 'id', codec: { codecId: 'pg/int4@1' } }),
    );

    expect(updateAst(contract, tables, { name: 'Alice' }, combineWhereExprs([byId])).where).toEqual(
      byId,
    );
    expect(
      updateAst(
        contract,
        tables,
        { name: 'Bob' },
        countMutationWhere(contract, tables, [byId], undefined),
      ).where,
    ).toEqual(byId);
  });

  describe('table/column resolution errors', () => {
    it('refuses an update of an unknown table', () => {
      const contract = getTestContract();
      expect(() =>
        updateAst(
          contract,
          tablesForTable(contract, 'missing_table', 'public'),
          { name: 'X' },
          undefined,
        ),
      ).toThrowError(/Unknown table "missing_table"/);
    });

    it('refuses an unknown column in an update', () => {
      const contract = getTestContract();
      expect(() =>
        updateAst(
          contract,
          tablesForTable(contract, 'users', 'public'),
          { not_a_real_column: 'X' },
          undefined,
        ),
      ).toThrowError(/Unknown column "not_a_real_column" in table "users"/);
    });

    it('refuses an insert into an unknown table', () => {
      const contract = getTestContract();
      const missing = createStatementTables({ namespaceId: 'public', tableName: 'missing_table' });
      expect(() => insertAst(contract, missing.root, [{ id: 1 }], undefined)).toThrowError(
        /Unknown table "missing_table"/,
      );
    });

    it('refuses an unknown column on an insert row', () => {
      const contract = getTestContract();
      expect(() => insertUsers(contract, [{ id: 1, not_a_real_column: 'X' }])).toThrowError(
        /Unknown column "not_a_real_column" in table "users"/,
      );
    });
  });
});
