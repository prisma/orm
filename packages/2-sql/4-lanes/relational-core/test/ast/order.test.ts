import { describe, expect, it } from 'vitest';
import { OrderByItem } from '../../src/ast/types';
import { renderOrderBySuffix } from '../../src/ast/util';
import { col, lowerExpr } from './test-helpers';

describe('ast/order', () => {
  it('creates asc and desc order items from rich expressions', () => {
    const asc = OrderByItem.asc(col('user', 'id'));
    const desc = OrderByItem.desc(lowerExpr(col('user', 'email')));

    expect(asc).toEqual(new OrderByItem(col('user', 'id'), 'asc'));
    expect(desc).toEqual(new OrderByItem(lowerExpr(col('user', 'email')), 'desc'));
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

  it('carries nulls placement through the constructor and factories', () => {
    const asc = OrderByItem.asc(col('user', 'id'), 'first');
    const desc = OrderByItem.desc(col('user', 'id'), 'last');

    expect(asc).toEqual(new OrderByItem(col('user', 'id'), 'asc', 'first'));
    expect(desc).toEqual(new OrderByItem(col('user', 'id'), 'desc', 'last'));
    expect(OrderByItem.asc(col('user', 'id')).nulls).toBeUndefined();
  });

  it('preserves nulls placement across rewrite', () => {
    const item = new OrderByItem(col('post', 'title'), 'asc', 'last');
    const rewritten = item.rewrite({
      columnRef: (expr) => (expr.table === 'post' ? col('article', expr.column) : expr),
    });

    expect(rewritten.expr).toEqual(col('article', 'title'));
    expect(rewritten.nulls).toBe('last');
  });

  it('renders the shared direction-plus-nulls suffix', () => {
    expect(renderOrderBySuffix(OrderByItem.asc(col('user', 'id')))).toBe(' ASC');
    expect(renderOrderBySuffix(new OrderByItem(col('user', 'id'), 'desc', 'first'))).toBe(
      ' DESC NULLS FIRST',
    );
    expect(renderOrderBySuffix(new OrderByItem(col('user', 'id'), 'asc', 'last'))).toBe(
      ' ASC NULLS LAST',
    );
  });

  it('flips nulls placement along with direction on reverse', () => {
    const reversed = new OrderByItem(col('user', 'id'), 'asc', 'last').reverse();

    expect(reversed).toMatchObject({ dir: 'desc', nulls: 'first' });
    expect(OrderByItem.asc(col('user', 'id')).reverse().nulls).toBeUndefined();
  });
});
