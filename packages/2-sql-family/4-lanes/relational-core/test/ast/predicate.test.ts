import { describe, expect, it } from 'vitest';
import {
  BinaryExpr,
  ExistsExpr,
  ListExpression,
  NotExpr,
  NullCheckExpr,
  OrExpr,
} from '../../src/ast/types';
import { col, lit, lowerExpr, param, simpleSelect } from './test-helpers';

describe('ast/predicate', () => {
  it('creates binary expressions across comparable operands', () => {
    const left = lowerExpr(col('user', 'email'));
    const list = ListExpression.of([param(0, 'firstId'), param(1, 'secondId')]);

    expect(BinaryExpr.eq(col('user', 'id'), param(2, 'userId'))).toEqual(
      new BinaryExpr('eq', col('user', 'id'), param(2, 'userId')),
    );
    expect(BinaryExpr.eq(left, col('post', 'email')).left).toEqual(left);
    expect(BinaryExpr.in(col('user', 'id'), list).right).toEqual(list);
  });

  it('not() wraps predicates in NotExpr', () => {
    const eq = BinaryExpr.eq(col('user', 'id'), param(0));
    expect(eq.not()).toBeInstanceOf(NotExpr);
    expect(eq.not().expr).toBe(eq);

    const nullCheck = NullCheckExpr.isNull(col('user', 'deletedAt'));
    expect(nullCheck.not()).toBeInstanceOf(NotExpr);
    expect(nullCheck.not().expr).toBe(nullCheck);
  });

  it('creates exists and not-exists predicates around select subqueries', () => {
    const subquery = simpleSelect('post', ['id']);

    const existsExpr = ExistsExpr.exists(subquery);
    const notExistsExpr = ExistsExpr.notExists(subquery);

    expect(existsExpr.subquery).toEqual(subquery);
    expect(existsExpr.notExists).toBe(false);
    expect(notExistsExpr.notExists).toBe(true);
    expect(notExistsExpr.not()).toBeInstanceOf(NotExpr);
    expect(notExistsExpr.not().expr).toBe(notExistsExpr);
  });

  it('collects refs across nested predicate trees', () => {
    const where = OrExpr.of([
      BinaryExpr.eq(lowerExpr(col('user', 'email')), lit('a@example.com')),
      ExistsExpr.exists(
        simpleSelect('post', ['id']).withWhere(
          BinaryExpr.eq(col('post', 'userId'), col('user', 'id')),
        ),
      ),
    ]);

    expect(where.collectColumnRefs()).toEqual([
      col('user', 'email'),
      col('post', 'id'),
      col('post', 'userId'),
      col('user', 'id'),
    ]);
  });
});
