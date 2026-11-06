import { describe, expect, it } from 'vitest';
import { OrderByItem, WindowFuncExpr } from '../../src/exports/ast';
import { col } from './test-helpers';

describe('ast/WindowFuncExpr', () => {
  it('exposes the window function name, partitionBy, and orderBy', () => {
    const expr = WindowFuncExpr.rowNumber({
      partitionBy: [col('post', 'title')],
      orderBy: [OrderByItem.desc(col('post', 'views'))],
    });

    expect(expr.kind).toBe('window-func');
    expect(expr.fn).toBe('row_number');
    expect(expr.args).toEqual([]);
    expect(expr.partitionBy).toEqual([col('post', 'title')]);
    expect(expr.orderBy).toEqual([OrderByItem.desc(col('post', 'views'))]);
  });

  it('drops empty partitionBy and orderBy to undefined', () => {
    const expr = WindowFuncExpr.rowNumber({ partitionBy: [], orderBy: [] });

    expect(expr.partitionBy).toBeUndefined();
    expect(expr.orderBy).toBeUndefined();
  });

  it('rewrites partitionBy and orderBy expressions', () => {
    const expr = WindowFuncExpr.rowNumber({
      partitionBy: [col('post', 'title')],
      orderBy: [OrderByItem.asc(col('post', 'views'))],
    });

    const rewritten = expr.rewrite({
      columnRef: (ref) => (ref.table === 'post' ? col('article', ref.column) : ref),
    });

    expect(rewritten).toEqual(
      WindowFuncExpr.rowNumber({
        partitionBy: [col('article', 'title')],
        orderBy: [OrderByItem.asc(col('article', 'views'))],
      }),
    );
  });

  it('collects column refs from partitionBy and orderBy', () => {
    const expr = WindowFuncExpr.rowNumber({
      partitionBy: [col('post', 'title'), col('post', 'authorId')],
      orderBy: [OrderByItem.desc(col('post', 'views')), OrderByItem.asc(col('post', 'createdAt'))],
    });

    expect(expr.collectColumnRefs()).toEqual([
      col('post', 'title'),
      col('post', 'authorId'),
      col('post', 'views'),
      col('post', 'createdAt'),
    ]);
  });

  it('produces frozen instances', () => {
    const expr = WindowFuncExpr.rowNumber({ partitionBy: [col('t', 'a')] });
    expect(Object.isFrozen(expr)).toBe(true);
  });
});
