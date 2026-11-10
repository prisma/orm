import { describe, expect, it } from 'vitest';
import {
  BinaryExpr,
  DefaultValueExpr,
  DeleteAst,
  InsertAst,
  InsertOnConflict,
  LockingClause,
  OrderByItem,
  SelectAst,
  UpdateAst,
} from '../../src/exports/ast';
import { col, param, returning, shiftParamRef, table } from './test-helpers';

describe('ast/builders', () => {
  it('builds select ASTs through fluent rich-node methods', () => {
    const ast = SelectAst.from(table('user'))
      .addProjection('id', col('user', 'id'))
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(1, 'id')))
      .withOrderBy([OrderByItem.asc(col('user', 'id'))])
      .withDistinct()
      .withDistinctOn([col('user', 'email')])
      .withGroupBy([col('user', 'id')])
      .withHaving(BinaryExpr.gt(col('user', 'id'), param(2, 'minId')))
      .withLimit(10)
      .withOffset(5);

    expect(ast).toMatchObject({
      from: table('user'),
      projection: [{ alias: 'id', expr: col('user', 'id') }],
      where: BinaryExpr.eq(col('user', 'id'), param(1, 'id')),
      distinct: true,
      distinctOn: [col('user', 'email')],
      groupBy: [col('user', 'id')],
      having: BinaryExpr.gt(col('user', 'id'), param(2, 'minId')),
      limit: 10,
      offset: 5,
    });
  });

  it('builds insert ASTs with on-conflict update sets', () => {
    const ast = InsertAst.into(table('user'))
      .withRows([
        {
          id: param(1, 'id'),
          email: param(2, 'email'),
        },
      ])
      .withOnConflict(
        InsertOnConflict.on([col('user', 'id')]).doUpdateSet({ email: param(3, 'email') }),
      )
      .withReturning(returning('user', ['id']));

    expect(ast.onConflict?.columns).toEqual([col('user', 'id')]);
    expect(ast.returning).toEqual(returning('user', ['id']));
  });

  it('builds insert ASTs with do-nothing conflicts and explicit row lists', () => {
    const conflictAst = InsertAst.into(table('user'))
      .withRows([{ id: param(1, 'id') }])
      .withOnConflict(InsertOnConflict.on([col('user', 'id')]).doNothing());
    const rowAst = InsertAst.into(table('user')).withRows([
      {
        id: param(1, 'id'),
        email: param(2, 'email'),
      },
      {
        id: param(3, 'id2'),
        email: new DefaultValueExpr(),
      },
    ]);

    expect(conflictAst.onConflict?.columns).toEqual([col('user', 'id')]);
    expect(rowAst.rows).toEqual([
      {
        id: param(1, 'id'),
        email: param(2, 'email'),
      },
      {
        id: param(3, 'id2'),
        email: new DefaultValueExpr(),
      },
    ]);
    expect(InsertAst.into(table('user')).withRows([]).rows).toEqual([]);
  });

  it('builds update and delete ASTs fluently', () => {
    const where = BinaryExpr.eq(col('user', 'id'), param(1, 'id'));
    const updateAst = UpdateAst.table(table('user'))
      .withSet({ email: param(2, 'email') })
      .withWhere(where)
      .withReturning(returning('user', ['id']));
    const deleteAst = DeleteAst.from(table('user'))
      .withWhere(where)
      .withReturning(returning('user', ['id']));

    expect(updateAst).toMatchObject({ where, returning: returning('user', ['id']) });
    expect(deleteAst).toMatchObject({ where, returning: returning('user', ['id']) });
  });

  describe('select locking', () => {
    const base = SelectAst.from(table('job', 'j')).addProjection('id', col('j', 'id'));
    const skipLocked = LockingClause.of('forUpdate', { of: ['j'], waitPolicy: 'skipLocked' });
    const share = LockingClause.of('forShare');

    it('keeps locking clauses through the other with... calls', () => {
      const where = BinaryExpr.eq(col('j', 'state'), param(1, 'state'));
      const ast = base
        .withLocking([skipLocked, share])
        .withFrom(table('job', 'j'))
        .withJoins([])
        .withProjection([...base.projection])
        .addProjection('state', col('j', 'state'))
        .withWhere(where)
        .withOrderBy([OrderByItem.asc(col('j', 'id'))])
        .withLimit(1)
        .withOffset(2)
        .withSelectAllIntent(undefined);

      expect(ast).toMatchObject({
        where,
        limit: 1,
        offset: 2,
        locking: [
          { strength: 'forUpdate', of: ['j'], waitPolicy: 'skipLocked' },
          { strength: 'forShare', of: undefined, waitPolicy: undefined },
        ],
      });
      expect(Object.isFrozen(ast.locking)).toBe(true);
    });

    it('keeps locking clauses through rewrite', () => {
      const ast = base
        .withWhere(BinaryExpr.eq(col('j', 'id'), param(0, 'id')))
        .withLocking([skipLocked]);

      const rewritten = ast.rewrite({ paramRef: shiftParamRef(1) });

      expect(rewritten.where).toEqual(BinaryExpr.eq(col('j', 'id'), param(1, 'id')));
      expect(rewritten.locking).toEqual([skipLocked]);
    });

    it('normalises an empty locking list to undefined', () => {
      expect(base.withLocking([skipLocked]).withLocking([]).locking).toBeUndefined();
      expect(base.locking).toBeUndefined();
      expect(SelectAst.noFrom().locking).toBeUndefined();
    });

    it('LockingClause.of normalises an empty of to undefined and freezes the instance', () => {
      const clause = LockingClause.of('forNoKeyUpdate', { of: [], waitPolicy: 'nowait' });

      expect(clause).toEqual(
        new LockingClause({ strength: 'forNoKeyUpdate', of: undefined, waitPolicy: 'nowait' }),
      );
      expect(clause).toMatchObject({
        strength: 'forNoKeyUpdate',
        of: undefined,
        waitPolicy: 'nowait',
      });
      expect(Object.isFrozen(clause)).toBe(true);
    });

    it('LockingClause freezes a copy of of', () => {
      const tables = ['a', 'b'];
      const clause = LockingClause.of('forKeyShare', { of: tables });
      tables.push('c');

      expect(clause.of).toEqual(['a', 'b']);
      expect(Object.isFrozen(clause.of)).toBe(true);
    });
  });
});
