import { MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import {
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoAggOperator,
} from '../src/aggregation-expressions';
import { MongoFieldFilter } from '../src/filter-expressions';
import {
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoSkipStage,
  MongoSortStage,
  MongoUnwindStage,
} from '../src/stages';
import type { MongoAggExprRewriter, MongoFilterRewriter } from '../src/visitors';

const takePlaceholder = new MongoPreparedParamRef('take', 'mongo/int32@1', false);

describe('MongoMatchStage', () => {
  it('wraps a filter expression', () => {
    const filter = MongoFieldFilter.eq('x', 1);
    const stage = new MongoMatchStage(filter);
    expect(stage.kind).toBe('match');
    expect(stage.filter).toBe(filter);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoMatchStage(MongoFieldFilter.eq('x', 1)))).toBe(true);
  });

  it('rewrite() rewrites the embedded filter', () => {
    const filter: MongoFilterRewriter = {
      field: (expr) => MongoFieldFilter.of(expr.field, '$gte', expr.value),
    };
    const stage = new MongoMatchStage(MongoFieldFilter.eq('x', 1));
    const rewritten = stage.rewrite({ filter }) as MongoMatchStage;
    expect(rewritten.kind).toBe('match');
    expect((rewritten.filter as MongoFieldFilter).op).toBe('$gte');
  });
});

describe('MongoProjectStage', () => {
  it('stores a projection map', () => {
    const stage = new MongoProjectStage({ name: 1, email: 1, _id: 0 });
    expect(stage.kind).toBe('project');
    expect(stage.projection).toEqual({ name: 1, email: 1, _id: 0 });
  });

  it('accepts computed projection values (MongoAggExpr)', () => {
    const expr = MongoAggOperator.of('$concat', [
      MongoAggFieldRef.of('first'),
      MongoAggLiteral.of(' '),
      MongoAggFieldRef.of('last'),
    ]);
    const stage = new MongoProjectStage({ fullName: expr, _id: 0 });
    expect(stage.projection['fullName']).toBe(expr);
    expect(stage.projection['_id']).toBe(0);
  });

  it('is frozen', () => {
    const stage = new MongoProjectStage({ name: 1 });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.projection)).toBe(true);
  });

  it('rewrite() returns this for scalar-only projections', () => {
    const stage = new MongoProjectStage({ name: 1 });
    expect(stage.rewrite({})).toBe(stage);
  });

  it('rewrite() recurses into expression projection values', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoProjectStage({
      fullName: MongoAggFieldRef.of('name'),
      _id: 0,
    });
    const rewritten = stage.rewrite({ aggExpr }) as MongoProjectStage;
    expect((rewritten.projection['fullName'] as MongoAggFieldRef).path).toBe('r.name');
    expect(rewritten.projection['_id']).toBe(0);
  });
});

describe('MongoSortStage', () => {
  it('stores a sort spec', () => {
    const stage = new MongoSortStage({ age: -1, name: 1 });
    expect(stage.kind).toBe('sort');
    expect(stage.sort).toEqual({ age: -1, name: 1 });
  });

  it('is frozen', () => {
    const stage = new MongoSortStage({ age: -1 });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.sort)).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoSortStage({ age: -1 });
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoLimitStage', () => {
  it('stores a limit value', () => {
    const stage = new MongoLimitStage(10);
    expect(stage.kind).toBe('limit');
    expect(stage.limit).toBe(10);
  });

  it('accepts zero', () => {
    expect(new MongoLimitStage(0).limit).toBe(0);
  });

  it('rejects negative values', () => {
    expect(() => new MongoLimitStage(-1)).toThrow('limit must be a non-negative integer');
  });

  it('rejects non-integer values', () => {
    expect(() => new MongoLimitStage(1.5)).toThrow('limit must be a non-negative integer');
  });

  it('accepts a placeholder', () => {
    expect(new MongoLimitStage(takePlaceholder).limit).toBe(takePlaceholder);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoLimitStage(5))).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoLimitStage(5);
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoSkipStage', () => {
  it('stores a skip value', () => {
    const stage = new MongoSkipStage(20);
    expect(stage.kind).toBe('skip');
    expect(stage.skip).toBe(20);
  });

  it('accepts zero', () => {
    expect(new MongoSkipStage(0).skip).toBe(0);
  });

  it('rejects negative values', () => {
    expect(() => new MongoSkipStage(-1)).toThrow('skip must be a non-negative integer');
  });

  it('rejects non-integer values', () => {
    expect(() => new MongoSkipStage(2.5)).toThrow('skip must be a non-negative integer');
  });

  it('accepts a placeholder', () => {
    expect(new MongoSkipStage(takePlaceholder).skip).toBe(takePlaceholder);
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoSkipStage(20))).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoSkipStage(20);
    expect(stage.rewrite({})).toBe(stage);
  });
});

describe('MongoLookupStage', () => {
  it('stores lookup config', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
    });
    expect(stage.kind).toBe('lookup');
    expect(stage.from).toBe('posts');
    expect(stage.localField).toBe('_id');
    expect(stage.foreignField).toBe('authorId');
    expect(stage.as).toBe('posts');
    expect(stage.pipeline).toBeUndefined();
  });

  it('supports nested pipeline', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('published', true))],
    });
    expect(stage.pipeline).toHaveLength(1);
  });

  it('is frozen', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('x', 1))],
    });
    expect(Object.isFrozen(stage)).toBe(true);
    expect(Object.isFrozen(stage.pipeline)).toBe(true);
  });

  it('rewrite() returns this when no pipeline', () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
    });
    expect(stage.rewrite({})).toBe(stage);
  });

  it('rewrite() rewrites nested pipeline stages', () => {
    const filter: MongoFilterRewriter = {
      field: (expr) => MongoFieldFilter.of(expr.field, '$ne', expr.value),
    };
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'posts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('published', true))],
    });
    const rewritten = stage.rewrite({ filter }) as MongoLookupStage;
    const match = rewritten.pipeline![0] as MongoMatchStage;
    expect((match.filter as MongoFieldFilter).op).toBe('$ne');
  });

  it('rejects construction with neither equality nor pipeline form', () => {
    expect(() => new MongoLookupStage({ from: 'posts', as: 'posts' })).toThrow(
      'MongoLookupStage requires either equality fields (localField/foreignField) or a pipeline',
    );
  });

  it('rejects localField without foreignField', () => {
    expect(() => new MongoLookupStage({ from: 'posts', localField: '_id', as: 'posts' })).toThrow(
      'MongoLookupStage requires both localField and foreignField together',
    );
  });

  it('rejects foreignField without localField', () => {
    expect(
      () => new MongoLookupStage({ from: 'posts', foreignField: 'authorId', as: 'posts' }),
    ).toThrow('MongoLookupStage requires both localField and foreignField together');
  });

  it('rejects let_ without pipeline', () => {
    expect(
      () =>
        new MongoLookupStage({
          from: 'orders',
          localField: '_id',
          foreignField: 'userId',
          as: 'orders',
          let_: { userId: MongoAggFieldRef.of('_id') },
        }),
    ).toThrow('MongoLookupStage let_ requires a pipeline');
  });

  it('supports correlated pipeline form with let_', () => {
    const stage = new MongoLookupStage({
      from: 'orders',
      as: 'matchingOrders',
      let_: { userId: MongoAggFieldRef.of('_id') },
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('status', 'active'))],
    });
    expect(stage.let_).toBeDefined();
    expect((stage.let_!['userId'] as MongoAggFieldRef).path).toBe('_id');
    expect(stage.localField).toBeUndefined();
    expect(stage.foreignField).toBeUndefined();
  });

  it('rewrite() recurses into let_ expressions', () => {
    const aggExpr: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`r.${expr.path}`),
    };
    const stage = new MongoLookupStage({
      from: 'orders',
      as: 'matchingOrders',
      let_: { userId: MongoAggFieldRef.of('_id') },
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('status', 'active'))],
    });
    const rewritten = stage.rewrite({ aggExpr }) as MongoLookupStage;
    expect((rewritten.let_!['userId'] as MongoAggFieldRef).path).toBe('r._id');
  });
});

describe('MongoUnwindStage', () => {
  it('stores path and preserveNullAndEmptyArrays', () => {
    const stage = new MongoUnwindStage('$posts', true);
    expect(stage.kind).toBe('unwind');
    expect(stage.path).toBe('$posts');
    expect(stage.preserveNullAndEmptyArrays).toBe(true);
    expect(stage.includeArrayIndex).toBeUndefined();
  });

  it('supports includeArrayIndex', () => {
    const stage = new MongoUnwindStage('$items', false, 'itemIndex');
    expect(stage.includeArrayIndex).toBe('itemIndex');
  });

  it('is frozen', () => {
    expect(Object.isFrozen(new MongoUnwindStage('$posts', false))).toBe(true);
  });

  it('rewrite() returns this (leaf stage)', () => {
    const stage = new MongoUnwindStage('$posts', false);
    expect(stage.rewrite({})).toBe(stage);
  });
});
