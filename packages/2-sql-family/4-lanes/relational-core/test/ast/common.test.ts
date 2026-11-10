import { describe, expect, it } from 'vitest';
import {
  AggregateExpr,
  JsonArrayAggExpr,
  JsonObjectExpr,
  LiteralExpr,
  NativeJsonValueProjection,
  OperationExpr,
  OrderByItem,
  ParamRef,
  ProjectionItem,
} from '../../src/exports/ast';
import { col, lit, lowerExpr, param, stringReturn, table } from './test-helpers';

describe('ast/common', () => {
  it('creates table and column refs through rich objects', () => {
    const source = table('user', 'u');
    const column = col('user', 'id');

    expect(source).toMatchObject({ kind: 'table-source', name: 'user', alias: 'u' });
    expect(column).toMatchObject({ kind: 'column-ref', table: 'user', column: 'id' });
  });

  it('creates param refs with value and options', () => {
    const original = param(1, 'userId');
    expect(original).toMatchObject({ kind: 'param-ref', value: 1, name: 'userId' });

    const withCodec = ParamRef.of('test', {
      name: 'field',
      codec: { codecId: 'pg/text@1' },
    });
    expect(withCodec).toMatchObject({
      value: 'test',
      name: 'field',
      codec: { codecId: 'pg/text@1' },
    });
  });

  it('creates operation expressions directly and through function helpers', () => {
    const explicit = new OperationExpr({
      method: 'concat',
      self: col('user', 'email'),
      args: [param(0, 'suffix')],
      returns: stringReturn,
      lowering: {
        targetFamily: 'sql',
        template: '{{self}} || {{arg0}}',
      },
    });
    const lowered = lowerExpr(col('user', 'email'));

    expect(explicit).toMatchObject({
      kind: 'operation',
      method: 'concat',
      args: [param(0, 'suffix')],
    });
    expect(explicit.baseColumnRef()).toEqual(col('user', 'email'));
    expect(lowered.lowering).toEqual({
      targetFamily: 'sql',
      template: 'lower({{self}})',
    });
  });

  it('creates aggregate expressions and validates required operands', () => {
    expect(AggregateExpr.count()).toEqual(new AggregateExpr('count'));
    expect(AggregateExpr.sum(col('post', 'likes'))).toEqual(
      new AggregateExpr('sum', col('post', 'likes')),
    );
    expect(() => new AggregateExpr('sum')).toThrow(
      'Aggregate function "sum" requires an expression',
    );
  });

  it('creates JSON expression nodes from rich entries and order items', () => {
    const objectExpr = JsonObjectExpr.fromEntries([
      JsonObjectExpr.entry('id', new NativeJsonValueProjection(col('user', 'id'))),
      JsonObjectExpr.entry('name', new NativeJsonValueProjection(lit('Alice'))),
    ]);
    const arrayExpr = JsonArrayAggExpr.of(
      new NativeJsonValueProjection(col('post', 'id')),
      'emptyArray',
      [OrderByItem.desc(col('post', 'createdAt'))],
    );

    expect(objectExpr).toEqual(
      new JsonObjectExpr([
        { key: 'id', value: new NativeJsonValueProjection(col('user', 'id')) },
        { key: 'name', value: new NativeJsonValueProjection(lit('Alice')) },
      ]),
    );
    expect(arrayExpr).toEqual(
      new JsonArrayAggExpr(new NativeJsonValueProjection(col('post', 'id')), 'emptyArray', [
        OrderByItem.desc(col('post', 'createdAt')),
      ]),
    );
  });

  it('creates ProjectionItem with optional codec', () => {
    const expr = col('user', 'id');

    const withoutCodec = ProjectionItem.of('id', expr);
    expect(withoutCodec).toMatchObject({
      kind: 'projection-item',
      alias: 'id',
      expr,
      codec: undefined,
    });

    const withCodec = ProjectionItem.of('id', expr, { codecId: 'pg/int4@1' });
    expect(withCodec).toMatchObject({
      kind: 'projection-item',
      alias: 'id',
      expr,
      codec: { codecId: 'pg/int4@1' },
    });

    const stamped = withoutCodec.withCodec({ codecId: 'pg/int4@1' });
    expect(stamped.codec).toEqual({ codecId: 'pg/int4@1' });
    expect(stamped.alias).toBe('id');
    expect(stamped.expr).toBe(expr);
  });

  it('creates literal expressions by value reference', () => {
    const obj = { foo: 'bar' };
    const arr = [1, 2, 3];

    expect(lit('test')).toEqual(new LiteralExpr('test'));
    expect(lit(42).value).toBe(42);
    expect(lit(true).value).toBe(true);
    expect(lit(null).value).toBeNull();
    expect(lit(obj).value).toBe(obj);
    expect(lit(arr).value).toBe(arr);
  });
});
