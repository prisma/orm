import { describe, expect, it } from 'vitest';
import { isOrderByDirection, isOrderByNulls, OrderByItem } from '../../src/ast/types';
import { col, lowerExpr } from './test-helpers';

describe('ast/order', () => {
  it('creates asc and desc order items from rich expressions', () => {
    const asc = OrderByItem.asc(col('user', 'id'));
    const desc = OrderByItem.desc(lowerExpr(col('user', 'email')));

    expect(asc).toEqual(new OrderByItem(col('user', 'id'), 'asc', undefined));
    expect(desc).toEqual(new OrderByItem(lowerExpr(col('user', 'email')), 'desc', undefined));
  });

  it('carries null placement from the asc and desc options', () => {
    expect(OrderByItem.asc(col('user', 'id'), { nulls: 'last' })).toMatchObject({
      dir: 'asc',
      nulls: 'last',
    });
    expect(OrderByItem.desc(col('user', 'id'), { nulls: 'first' })).toMatchObject({
      dir: 'desc',
      nulls: 'first',
    });
    expect(OrderByItem.asc(col('user', 'id')).nulls).toBeUndefined();
  });

  it('preserves null placement through rewrite', () => {
    const rewritten = OrderByItem.desc(col('post', 'title'), { nulls: 'last' }).rewrite({
      columnRef: (expr) => col('article', expr.column),
    });

    expect(rewritten).toEqual(new OrderByItem(col('article', 'title'), 'desc', 'last'));
  });

  it('flips null placement when reversing', () => {
    const expr = col('user', 'id');

    expect(OrderByItem.asc(expr, { nulls: 'last' }).reverse()).toEqual(
      new OrderByItem(expr, 'desc', 'first'),
    );
    expect(OrderByItem.desc(expr, { nulls: 'first' }).reverse()).toEqual(
      new OrderByItem(expr, 'asc', 'last'),
    );
    expect(OrderByItem.asc(expr).reverse()).toEqual(new OrderByItem(expr, 'desc', undefined));
  });

  it('rewrites order item expressions immutably', () => {
    const item = OrderByItem.asc(col('post', 'title'));
    const rewritten = item.rewrite({
      columnRef: (expr) => (expr.table === 'post' ? col('article', expr.column) : expr),
    });

    expect(item.expr).toEqual(col('post', 'title'));
    expect(rewritten.expr).toEqual(col('article', 'title'));
    expect(rewritten.dir).toBe('asc');
  });

  it('reverses direction into a new frozen instance, preserving expr identity', () => {
    const expr = col('user', 'id');
    const asc = OrderByItem.asc(expr);
    const reversed = asc.reverse();

    expect(reversed.dir).toBe('desc');
    expect(reversed.expr).toBe(expr);
    expect(reversed).not.toBe(asc);
    expect(asc.dir).toBe('asc');
    expect(Object.isFrozen(reversed)).toBe(true);
  });

  it('round-trips a double reverse back to the original direction', () => {
    const desc = OrderByItem.desc(col('post', 'title'));
    const roundTrip = desc.reverse().reverse();

    expect(roundTrip.dir).toBe('desc');
    expect(roundTrip.expr).toBe(desc.expr);
  });

  it('refuses a direction outside asc and desc', () => {
    expect(() => new OrderByItem(col('user', 'id'), 'up' as never, undefined)).toThrow(
      expect.objectContaining({ code: 'RUNTIME.AST_INVALID' }),
    );
  });

  it('refuses a null placement outside first and last', () => {
    expect(() =>
      OrderByItem.asc(col('user', 'id'), { nulls: 'last, (SELECT 1/0)' as never }),
    ).toThrow(expect.objectContaining({ code: 'RUNTIME.AST_INVALID' }));
  });

  it('recognises exactly the allowed directions and null placements', () => {
    expect(['asc', 'desc', 'ASC', 'up', undefined].map(isOrderByDirection)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
    expect(['first', 'last', 'LAST', 'middle', undefined].map(isOrderByNulls)).toEqual([
      true,
      true,
      false,
      false,
      false,
    ]);
  });

  it('rebuilds an item around a new expression, keeping direction and null placement', () => {
    const item = OrderByItem.desc(col('post', 'title'), { nulls: 'first' });

    expect(item.withExpr(col('article', 'title'))).toEqual(
      new OrderByItem(col('article', 'title'), 'desc', 'first'),
    );
  });
});
