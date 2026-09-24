import { describe, expect, it } from 'vitest';
import {
  ColumnRef,
  DefaultValueExpr,
  type DoUpdateSetConflictAction,
  InsertAst,
  InsertOnConflict,
  ProjectionItem,
} from '../../src/exports/ast';
import { col, param, returning, table } from './test-helpers';

describe('ast/insert', () => {
  it('creates insert ASTs with a single values row', () => {
    const insertAst = InsertAst.into(table('user')).withRows([
      {
        id: param(0, 'id'),
        email: param(1, 'email'),
      },
    ]);

    expect(insertAst.table).toEqual(table('user'));
    expect(insertAst.rows).toEqual([
      {
        id: param(0, 'id'),
        email: param(1, 'email'),
      },
    ]);
    expect(insertAst.returning).toBeUndefined();
  });

  it('creates insert ASTs with returning columns', () => {
    const insertAst = InsertAst.into(table('user'))
      .withRows([
        {
          id: param(0, 'id'),
          email: param(1, 'email'),
        },
      ])
      .withReturning(returning('user', ['id', 'email']));

    expect(insertAst.returning).toEqual(returning('user', ['id', 'email']));
  });

  it('creates insert ASTs with multiple rows and explicit defaults', () => {
    const insertAst = InsertAst.into(table('user')).withRows([
      {
        id: param(0, 'id'),
        email: param(1, 'email'),
      },
      {
        id: param(2, 'id2'),
        email: new DefaultValueExpr(),
      },
    ]);

    expect(insertAst.rows[1]?.['email']).toEqual(new DefaultValueExpr());
  });

  it('preserves empty value objects and explicit empty row lists', () => {
    expect(InsertAst.into(table('user')).withRows([{}]).rows).toEqual([{}]);
    expect(InsertAst.into(table('user')).withRows([]).rows).toEqual([]);
  });

  it('stores on-conflict update actions', () => {
    const onConflict = InsertOnConflict.on([col('user', 'id')]).doUpdateSet({
      email: param(2, 'updatedEmail'),
    });
    const insertAst = InsertAst.into(table('user'))
      .withRows([
        {
          id: param(0, 'id'),
          email: param(1, 'email'),
        },
      ])
      .withOnConflict(onConflict);

    expect(insertAst.onConflict?.columns).toEqual([col('user', 'id')]);
    expect((insertAst.onConflict!.action as DoUpdateSetConflictAction).set).toEqual({
      email: param(2, 'updatedEmail'),
    });
  });

  it('stores on-conflict do-nothing actions', () => {
    const insertAst = InsertAst.into(table('user'))
      .withRows([{ id: param(0, 'id') }])
      .withOnConflict(InsertOnConflict.on([col('user', 'id')]).doNothing());

    expect(insertAst.onConflict?.action?.kind).toBe('do-nothing');
  });

  it('stores targetless do-nothing on-conflict actions', () => {
    const onConflict = InsertOnConflict.doNothing();

    expect(onConflict.columns).toEqual([]);
    expect(onConflict.action.kind).toBe('do-nothing');
  });

  it('carries a targetless on-conflict through the insert AST', () => {
    const insertAst = InsertAst.into(table('user'))
      .withRows([{ id: param(0, 'id') }])
      .withOnConflict(InsertOnConflict.doNothing());

    expect(insertAst.onConflict?.columns).toEqual([]);
    expect(insertAst.onConflict?.action.kind).toBe('do-nothing');
  });

  it('rewrite preserves a targetless on-conflict', () => {
    const insertAst = InsertAst.into(table('user'))
      .withRows([{ id: param(0, 'id') }])
      .withOnConflict(InsertOnConflict.doNothing());

    const rewritten = insertAst.rewrite({ columnRef: (ref) => ref });

    expect(rewritten.onConflict?.columns).toEqual([]);
    expect(rewritten.onConflict?.action.kind).toBe('do-nothing');
  });

  it('collectParamRefs returns row params for a targetless on-conflict', () => {
    const rowId = param('u1', 'id');
    const insertAst = InsertAst.into(table('user'))
      .withRows([{ id: rowId }])
      .withOnConflict(InsertOnConflict.doNothing());

    expect(insertAst.collectParamRefs()).toEqual([rowId]);
  });

  it('collectParamRefs returns row params then onConflict set params', () => {
    const rowId = param('u1', 'id');
    const rowEmail = param('a@b.com', 'email');
    const conflictEmail = param('updated@b.com', 'updatedEmail');
    const insertAst = InsertAst.into(table('user'))
      .withRows([{ id: rowId, email: rowEmail }])
      .withOnConflict(
        InsertOnConflict.on([col('user', 'id')]).doUpdateSet({ email: conflictEmail }),
      );

    expect(insertAst.collectParamRefs()).toEqual([rowId, rowEmail, conflictEmail]);
  });

  it('collectParamRefs skips DefaultValueExpr entries', () => {
    const rowId = param('u1', 'id');
    const insertAst = InsertAst.into(table('user')).withRows([
      {
        id: rowId,
        email: new DefaultValueExpr(),
      },
    ]);

    expect(insertAst.collectParamRefs()).toEqual([rowId]);
  });

  it('collectParamRefs preserves row-major order across multiple rows', () => {
    const r1Id = param('u1', 'id');
    const r1Email = param('a@b.com', 'email');
    const r2Id = param('u2', 'id');
    const r2Email = param('c@d.com', 'email');
    const insertAst = InsertAst.into(table('user')).withRows([
      { id: r1Id, email: r1Email },
      { id: r2Id, email: r2Email },
    ]);

    expect(insertAst.collectParamRefs()).toEqual([r1Id, r1Email, r2Id, r2Email]);
  });

  it('rewrite descends into returning ProjectionItem.expr', () => {
    const insertAst = InsertAst.into(table('user'))
      .withRows([{ id: param(1, 'id') }])
      .withReturning([ProjectionItem.of('id', col('user', 'id'), { codecId: 'pg/int4@1' })]);

    const rewritten = insertAst.rewrite({
      columnRef: (ref) => ColumnRef.of(ref.table, `${ref.column}_renamed`),
    });

    expect(rewritten.returning).toEqual([
      ProjectionItem.of('id', ColumnRef.of('user', 'id_renamed'), { codecId: 'pg/int4@1' }),
    ]);
  });

  it('collectParamRefs surfaces ParamRefs from returning items', () => {
    const idCodec = param(1, 'rid');
    const insertAst = InsertAst.into(table('user'))
      .withRows([{ id: param(0, 'id') }])
      .withReturning([
        ProjectionItem.of('id', col('user', 'id')),
        ProjectionItem.of('computed', idCodec),
      ]);

    expect(insertAst.collectParamRefs()).toContain(idCodec);
  });
});
