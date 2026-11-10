import { describe, expect, it } from 'vitest';
import { BinaryExpr, ColumnRef, ProjectionItem, UpdateAst } from '../../src/ast/types';
import { col, param, returning, table } from './test-helpers';

describe('ast/update', () => {
  it('creates update ASTs with table, set, and where clauses', () => {
    const where = BinaryExpr.eq(col('user', 'id'), param(1, 'userId'));
    const updateAst = UpdateAst.table(table('user'))
      .withSet({
        email: param(0, 'email'),
      })
      .withWhere(where);

    expect(updateAst).toMatchObject({
      table: table('user'),
      set: { email: param(0, 'email') },
      where,
      returning: undefined,
    });
  });

  it('creates update ASTs with returning clauses and multiple set values', () => {
    const updateAst = UpdateAst.table(table('user'))
      .withSet({
        email: param(0, 'email'),
        name: param(1, 'name'),
      })
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(2, 'userId')))
      .withReturning(returning('user', ['id', 'email']));

    expect(updateAst.set).toEqual({
      email: param(0, 'email'),
      name: param(1, 'name'),
    });
    expect(updateAst.returning).toEqual(returning('user', ['id', 'email']));
  });

  it('supports column refs in set values and empty set objects', () => {
    expect(
      UpdateAst.table(table('user'))
        .withSet({
          id: col('user', 'id'),
          email: param(0, 'email'),
        })
        .withWhere(BinaryExpr.eq(col('user', 'id'), param(1, 'userId'))).set,
    ).toEqual({
      id: col('user', 'id'),
      email: param(0, 'email'),
    });
    expect(UpdateAst.table(table('user')).withSet({}).set).toEqual({});
  });

  it('collectParamRefs returns set params then where params', () => {
    const emailParam = param('new@example.com', 'email');
    const whereParam = param(42, 'userId');
    const updateAst = UpdateAst.table(table('user'))
      .withSet({ email: emailParam })
      .withWhere(BinaryExpr.eq(col('user', 'id'), whereParam));

    expect(updateAst.collectParamRefs()).toEqual([emailParam, whereParam]);
  });

  it('collectParamRefs skips ColumnRef set values', () => {
    const emailParam = param('new@example.com', 'email');
    const updateAst = UpdateAst.table(table('user')).withSet({
      id: col('user', 'id'),
      email: emailParam,
    });

    expect(updateAst.collectParamRefs()).toEqual([emailParam]);
  });

  it('rewrite descends into returning ProjectionItem.expr', () => {
    const updateAst = UpdateAst.table(table('user'))
      .withSet({ email: param(0, 'email') })
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(1, 'userId')))
      .withReturning([ProjectionItem.of('email', col('user', 'email'), { codecId: 'pg/text@1' })]);

    const rewritten = updateAst.rewrite({
      columnRef: (ref) => ColumnRef.of(ref.table, `${ref.column}_v2`),
    });

    expect(rewritten.returning).toEqual([
      ProjectionItem.of('email', ColumnRef.of('user', 'email_v2'), { codecId: 'pg/text@1' }),
    ]);
  });
});
