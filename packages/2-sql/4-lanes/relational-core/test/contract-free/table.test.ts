import { describe, expect, it } from 'vitest';
import {
  type AndExpr,
  type AnyExpression,
  type BinaryExpr,
  ColumnRef,
  InsertAst,
  type InsertValue,
  type NullCheckExpr,
  type ParamRef,
  RawExpr,
  SelectAst,
  TableSource,
  UpdateAst,
} from '../../src/exports/ast';
import {
  CfExpr,
  CfInsertQuery,
  CfUpdateQuery,
  CfUpsertBuilder,
  type ColumnDescriptor,
  table,
} from '../../src/exports/contract-free';

const TEXT: ColumnDescriptor = { codecId: 'test/text@1', nullable: false };
const INT: ColumnDescriptor = { codecId: 'test/int@1', nullable: false };
const NULLABLE_TEXT: ColumnDescriptor = { codecId: 'test/text@1', nullable: true };

const src = TableSource.named('things');
const tbl = table(src, { id: INT, name: TEXT, note: NULLABLE_TEXT });

describe('table() — handle structure', () => {
  it('exposes the TableSource', () => {
    expect(tbl.source).toBe(src);
  });

  it('exposes column proxies keyed by schema', () => {
    expect(tbl.id.columnName).toBe('id');
    expect(tbl.id.tableName).toBe('things');
    expect(tbl.id.codecId).toBe('test/int@1');
    expect(tbl.id.nullable).toBe(false);
    expect(tbl.note.nullable).toBe(true);
  });
});

describe('ColumnProxy — expression methods', () => {
  it('.eq(value) wraps a plain JS value in a ParamRef with the column codec', () => {
    const expr = tbl.name.eq('alice');
    expect(expr).toBeInstanceOf(CfExpr);
    const binary = expr.ast as unknown as BinaryExpr;
    expect(binary.kind).toBe('binary');
    expect(binary.op).toBe('eq');
    expect(binary.left.kind).toBe('column-ref');
    const left = binary.left as unknown as ColumnRef;
    const right = binary.right as unknown as ParamRef;
    expect(left.column).toBe('name');
    expect(binary.right.kind).toBe('param-ref');
    expect(right.value).toBe('alice');
    expect(right.codec?.codecId).toBe('test/text@1');
  });

  it('.eq(expr) passes an existing AST expression through without re-wrapping', () => {
    const existing = ColumnRef.of('other', 'id');
    const expr = tbl.id.eq(existing);
    const binary = expr.ast as unknown as BinaryExpr;
    expect(binary.right.kind).toBe('column-ref');
    expect((binary.right as unknown as ColumnRef).table).toBe('other');
  });

  it('.neq(value) produces a "neq" binary expression', () => {
    const binary = tbl.id.neq(42).ast as unknown as BinaryExpr;
    expect(binary.op).toBe('neq');
    expect((binary.right as unknown as ParamRef).value).toBe(42);
  });

  it('.isNull() produces a null-check expression', () => {
    const expr = tbl.note.isNull().ast as unknown as NullCheckExpr;
    expect(expr.kind).toBe('null-check');
    expect(expr.isNull).toBe(true);
  });

  it('.isNotNull() produces a null-check expression with isNull=false', () => {
    const expr = tbl.note.isNotNull().ast as unknown as NullCheckExpr;
    expect(expr.isNull).toBe(false);
  });

  it('.toRef() returns a ColumnRef for the column', () => {
    const ref = tbl.name.toRef();
    expect(ref).toBeInstanceOf(ColumnRef);
    expect(ref.table).toBe('things');
    expect(ref.column).toBe('name');
  });

  it('.toProjectionItem() uses columnName as default alias', () => {
    const item = tbl.name.toProjectionItem();
    expect(item.alias).toBe('name');
    expect(item.codec?.codecId).toBe('test/text@1');
  });

  it('.toProjectionItem(alias) uses the supplied alias', () => {
    expect(tbl.name.toProjectionItem('label').alias).toBe('label');
  });
});

describe('CfExpr — boolean combinators', () => {
  it('.and() produces AndExpr with both sides', () => {
    const expr = tbl.id.eq(1).and(tbl.name.eq('alice'));
    const and = expr.ast as unknown as AndExpr;
    expect(and.kind).toBe('and');
    expect(and.exprs.length).toBe(2);
  });

  it('.or() produces OrExpr', () => {
    const expr = tbl.id.eq(1).or(tbl.name.eq('alice'));
    expect(expr.ast.kind).toBe('or');
  });

  it('.not() wraps the expression in a NotExpr', () => {
    const expr = tbl.id.eq(1).not();
    expect(expr.ast.kind).toBe('not');
  });

  it('chained .and().and() flattens correctly — two nested AndExprs', () => {
    const expr = tbl.id.eq(1).and(tbl.name.eq('alice')).and(tbl.note.isNull());
    const outer = expr.ast as unknown as AndExpr;
    expect(outer.kind).toBe('and');
    // inner .and() is the left child, wrapped again
    expect(outer.exprs.length).toBe(2);
  });
});

describe('table().insert()', () => {
  it('produces CfInsertQuery', () => {
    expect(tbl.insert({ id: 1, name: 'alice', note: null })).toBeInstanceOf(CfInsertQuery);
  });

  it('.build() wraps plain values as ParamRef with per-column codec', () => {
    const ast = tbl.insert({ id: 42, name: 'bob', note: null }).build();
    expect(ast).toBeInstanceOf(InsertAst);
    expect(ast.table.name).toBe('things');
    const row = ast.rows[0]! as unknown as {
      id: InsertValue;
      name: InsertValue;
      note: InsertValue;
    };
    const idParam = row.id as unknown as ParamRef;
    expect(idParam.kind).toBe('param-ref');
    expect(idParam.value).toBe(42);
    expect(idParam.codec?.codecId).toBe('test/int@1');
    expect((row.name as unknown as ParamRef).value).toBe('bob');
    const noteParam = row.note as unknown as ParamRef;
    expect(noteParam.value).toBeNull();
    expect(noteParam.codec?.codecId).toBe('test/text@1');
  });

  it('.build() passes ColumnRef values through without re-wrapping', () => {
    const ref = ColumnRef.of('excluded', 'id');
    const ast = tbl.insert({ id: ref, name: 'test', note: null }).build();
    const idCell = ast.rows[0]! as unknown as { id: InsertValue };
    const idRef = idCell.id as unknown as ColumnRef;
    expect(idRef.kind).toBe('column-ref');
    expect(idRef.table).toBe('excluded');
  });

  it('.build() passes RawExpr values through without re-wrapping', () => {
    // The assertion is that `.build()` passes the RawExpr through untouched, so this codec is
    // never resolved; a fictional id says so rather than implying the choice matters.
    const raw = new RawExpr({
      parts: ['now()'],
      returns: { codecId: 'test/never-resolved@1', nullable: false },
    });
    const ast = tbl.insert({ id: 1, name: raw, note: null }).build();
    const nameCell = ast.rows[0]! as unknown as { name: InsertValue };
    expect((nameCell.name as unknown as RawExpr).kind).toBe('raw-expr');
  });

  it('.returning() adds a RETURNING projection', () => {
    const ast = tbl.insert({ id: 1, name: 'alice', note: null }).returning(tbl.id).build();
    expect(ast.returning?.length).toBe(1);
    expect(ast.returning?.[0]?.alias).toBe('id');
  });

  it('.returning() is immutable — original query unchanged', () => {
    const q1 = tbl.insert({ id: 1, name: 'alice', note: null });
    const q2 = q1.returning(tbl.id);
    expect(q1.build().returning).toBeUndefined();
    expect(q2.build().returning?.length).toBe(1);
  });
});

describe('table().update()', () => {
  it('produces CfUpdateQuery', () => {
    expect(tbl.update()).toBeInstanceOf(CfUpdateQuery);
  });

  it('.set().where().returning().build() produces a correct UpdateAst', () => {
    const ast = tbl.update().set({ name: 'carol' }).where(tbl.id.eq(7)).returning(tbl.name).build();

    expect(ast).toBeInstanceOf(UpdateAst);
    expect(ast.table.name).toBe('things');
    const setValues = ast.set as unknown as { name: AnyExpression };
    const nameParam = setValues.name as unknown as ParamRef;
    expect(nameParam.value).toBe('carol');
    expect(nameParam.codec?.codecId).toBe('test/text@1');
    expect(ast.where?.kind).toBe('binary');
    expect(ast.returning?.length).toBe(1);
    expect(ast.returning?.[0]?.alias).toBe('name');
  });

  it('.set() with an AST expression in value position passes it through', () => {
    const excluded = ColumnRef.of('excluded', 'name');
    const ast = tbl.update().set({ name: excluded }).where(tbl.id.eq(1)).build();
    const setValues = ast.set as unknown as { name: AnyExpression };
    const nameRef = setValues.name as unknown as ColumnRef;
    expect(nameRef.kind).toBe('column-ref');
    expect(nameRef.table).toBe('excluded');
  });

  it('immutability — each chained call returns a distinct instance', () => {
    const q1 = tbl.update();
    const q2 = q1.set({ name: 'x' });
    const q3 = q2.where(tbl.id.eq(1));
    const q4 = q3.returning(tbl.id);
    expect(q1).not.toBe(q2);
    expect(q2).not.toBe(q3);
    expect(q3).not.toBe(q4);
    expect(q1.build().set).toEqual({});
    expect(q2.build().where).toBeUndefined();
  });

  it('omitting .returning() produces no RETURNING clause', () => {
    const ast = tbl.update().set({ name: 'x' }).where(tbl.id.eq(1)).build();
    expect(ast.returning).toBeUndefined();
  });

  it('CfExpr.and() in .where() builds AndExpr', () => {
    const ast = tbl
      .update()
      .set({ name: 'x' })
      .where(tbl.id.eq(1).and(tbl.name.eq('old')))
      .build();
    expect(ast.where?.kind).toBe('and');
  });
});

describe('table().upsert()', () => {
  it('produces CfUpsertBuilder', () => {
    expect(tbl.upsert({ id: 1, name: 'alice', note: null })).toBeInstanceOf(CfUpsertBuilder);
  });

  it('.onConflict().doUpdate(callback) — callback receives ExcludedProxy', () => {
    const ast = tbl
      .upsert({ id: 1, name: 'alice', note: null })
      .onConflict(tbl.id)
      .doUpdate((excluded) => ({ name: excluded.name }))
      .build();

    expect(ast).toBeInstanceOf(InsertAst);
    expect(ast.onConflict?.columns.length).toBe(1);
    expect(ast.onConflict?.columns[0]?.column).toBe('id');
    expect(ast.onConflict?.action.kind).toBe('do-update-set');
    const action = ast.onConflict!.action as unknown as { set: { name: ColumnRef } };
    const setEntry = action.set.name;
    expect(setEntry.kind).toBe('column-ref');
    expect(setEntry.table).toBe('excluded');
    expect(setEntry.column).toBe('name');
  });

  it('.onConflict().doUpdate(plainObject) — plain set map', () => {
    const raw = ColumnRef.of('excluded', 'name');
    const ast = tbl
      .upsert({ id: 1, name: 'alice', note: null })
      .onConflict(tbl.id)
      .doUpdate({ name: raw })
      .build();
    expect(ast.onConflict?.action.kind).toBe('do-update-set');
  });

  it('.onConflict().doNothing() — DO NOTHING conflict action', () => {
    const ast = tbl
      .upsert({ id: 1, name: 'alice', note: null })
      .onConflict(tbl.id)
      .doNothing()
      .build();
    expect(ast.onConflict?.action.kind).toBe('do-nothing');
  });
});

describe('table() with aliased source', () => {
  const aliasedSrc = TableSource.named('things', 't');
  const aliasedTbl = table(aliasedSrc, { id: INT, name: TEXT, note: NULLABLE_TEXT });

  it('column proxy tableName reflects the alias', () => {
    expect(aliasedTbl.id.tableName).toBe('t');
  });

  it('.toRef() uses the alias as table qualifier', () => {
    const ref = aliasedTbl.name.toRef();
    expect(ref.table).toBe('t');
    expect(ref.column).toBe('name');
  });

  it('.eq() emits a ColumnRef against the alias, not the base table name', () => {
    const binary = aliasedTbl.name.eq('alice').ast as unknown as BinaryExpr;
    expect((binary.left as unknown as ColumnRef).table).toBe('t');
  });
});

describe('ColumnProxy — null equality routing', () => {
  it('.eq(null) produces IS NULL, not = NULL', () => {
    const expr = tbl.note.eq(null).ast as unknown as NullCheckExpr;
    expect(expr.kind).toBe('null-check');
    expect(expr.isNull).toBe(true);
  });

  it('.neq(null) produces IS NOT NULL, not <> NULL', () => {
    const expr = tbl.note.neq(null).ast as unknown as NullCheckExpr;
    expect(expr.kind).toBe('null-check');
    expect(expr.isNull).toBe(false);
  });
});
describe('table().select()', () => {
  it('produces a SelectAst with the specified columns', () => {
    const ast = tbl.select(tbl.id, tbl.name).build();
    expect(ast).toBeInstanceOf(SelectAst);
    expect(ast.projection.length).toBe(2);
    expect(ast.projection[0]!.alias).toBe('id');
    expect(ast.projection[1]!.alias).toBe('name');
  });

  it('.where() filters the result', () => {
    const ast = tbl.select(tbl.id).where(tbl.id.eq(5)).build();
    expect(ast.where?.kind).toBe('binary');
  });

  it('.orderBy() defaults to ascending and accumulates in call order', () => {
    const ast = tbl.select(tbl.id).orderBy(tbl.name).orderBy(tbl.id, 'desc').build();

    expect(
      ast.orderBy?.map((item) => ({
        column: (item.expr as unknown as ColumnRef).column,
        dir: item.dir,
      })),
    ).toEqual([
      { column: 'name', dir: 'asc' },
      { column: 'id', dir: 'desc' },
    ]);
  });

  it('.orderBy() composes with .where()', () => {
    const ast = tbl.select(tbl.id).where(tbl.id.eq(5)).orderBy(tbl.id, 'desc').build();

    expect({ where: ast.where?.kind, order: ast.orderBy?.length }).toEqual({
      where: 'binary',
      order: 1,
    });
  });
});
