import { describe, expect, it } from 'vitest';
import { BinaryExpr, ColumnRef, DeleteAst, ProjectionItem } from '../../src/ast/types';
import { col, param, returning, table } from './test-helpers';

describe('ast/delete', () => {
  it('creates delete ASTs with table and where clauses', () => {
    const where = BinaryExpr.eq(col('user', 'id'), param(0, 'userId'));
    const deleteAst = DeleteAst.from(table('user')).withWhere(where);

    expect(deleteAst.table).toEqual(table('user'));
    expect(deleteAst.where).toEqual(where);
    expect(deleteAst.returning).toBeUndefined();
  });

  it('creates delete ASTs with returning clauses', () => {
    const deleteAst = DeleteAst.from(table('user'))
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(0, 'userId')))
      .withReturning(returning('user', ['id', 'email']));

    expect(deleteAst.returning).toEqual(returning('user', ['id', 'email']));
  });

  it('collectParamRefs returns where params', () => {
    const whereParam = param(42, 'userId');
    const deleteAst = DeleteAst.from(table('user')).withWhere(
      BinaryExpr.eq(col('user', 'id'), whereParam),
    );

    expect(deleteAst.collectParamRefs()).toEqual([whereParam]);
  });

  it('collectParamRefs returns empty array without where', () => {
    const deleteAst = DeleteAst.from(table('user'));
    expect(deleteAst.collectParamRefs()).toEqual([]);
  });

  it('rewrite descends into returning ProjectionItem.expr', () => {
    const deleteAst = DeleteAst.from(table('user'))
      .withWhere(BinaryExpr.eq(col('user', 'id'), param(0, 'userId')))
      .withReturning([ProjectionItem.of('id', col('user', 'id'), { codecId: 'pg/int4@1' })]);

    const rewritten = deleteAst.rewrite({
      columnRef: (ref) => ColumnRef.of(ref.table, `${ref.column}_renamed`),
    });

    expect(rewritten.returning).toEqual([
      ProjectionItem.of('id', ColumnRef.of('user', 'id_renamed'), { codecId: 'pg/int4@1' }),
    ]);
  });
});
