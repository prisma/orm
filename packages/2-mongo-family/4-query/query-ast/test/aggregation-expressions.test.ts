import { describe, expect, it } from 'vitest';
import type { MongoAggExpr } from '../src/aggregation-expressions';
import {
  MongoAggAccumulator,
  MongoAggArrayFilter,
  MongoAggCond,
  MongoAggFieldRef,
  MongoAggLet,
  MongoAggLiteral,
  MongoAggMap,
  MongoAggMergeObjects,
  MongoAggOperator,
  MongoAggReduce,
  MongoAggSwitch,
} from '../src/aggregation-expressions';
import type { MongoAggExprRewriter, MongoAggExprVisitor } from '../src/visitors';

describe('MongoAggFieldRef', () => {
  it('constructs with path', () => {
    const ref = MongoAggFieldRef.of('name');
    expect(ref.kind).toBe('fieldRef');
    expect(ref.path).toBe('name');
  });

  it('is frozen after construction', () => {
    const ref = MongoAggFieldRef.of('name');
    expect(Object.isFrozen(ref)).toBe(true);
  });

  it('rejects empty path', () => {
    expect(() => MongoAggFieldRef.of('')).toThrow('Field path must not be empty');
  });
});

describe('MongoAggLiteral', () => {
  it('constructs with numeric value', () => {
    const lit = MongoAggLiteral.of(42);
    expect(lit.kind).toBe('literal');
    expect(lit.value).toBe(42);
  });

  it('is frozen after construction', () => {
    const lit = MongoAggLiteral.of(42);
    expect(Object.isFrozen(lit)).toBe(true);
  });
});

describe('MongoAggOperator', () => {
  it('constructs with single arg', () => {
    const expr = MongoAggOperator.of('$toLower', MongoAggFieldRef.of('name'));
    expect(expr.kind).toBe('operator');
    expect(expr.op).toBe('$toLower');
    expect(Array.isArray(expr.args)).toBe(false);
  });

  it('constructs with array args', () => {
    const expr = MongoAggOperator.of('$add', [
      MongoAggFieldRef.of('price'),
      MongoAggFieldRef.of('tax'),
    ]);
    expect(expr.op).toBe('$add');
    expect(Array.isArray(expr.args)).toBe(true);
    expect(expr.args).toHaveLength(2);
  });

  it('freezes array args', () => {
    const expr = MongoAggOperator.of('$add', [MongoAggFieldRef.of('a'), MongoAggFieldRef.of('b')]);
    expect(Object.isFrozen(expr.args)).toBe(true);
  });

  it('is frozen after construction', () => {
    const expr = MongoAggOperator.of('$abs', MongoAggFieldRef.of('x'));
    expect(Object.isFrozen(expr)).toBe(true);
  });

  it('add() creates $add operator', () => {
    const expr = MongoAggOperator.add(MongoAggFieldRef.of('a'), MongoAggFieldRef.of('b'));
    expect(expr.op).toBe('$add');
    expect(expr.args).toHaveLength(2);
  });

  it('subtract() creates $subtract operator', () => {
    const expr = MongoAggOperator.subtract(MongoAggFieldRef.of('a'), MongoAggLiteral.of(1));
    expect(expr.op).toBe('$subtract');
    expect(expr.args).toHaveLength(2);
  });

  it('multiply() creates $multiply operator', () => {
    const expr = MongoAggOperator.multiply(MongoAggFieldRef.of('price'), MongoAggLiteral.of(1.1));
    expect(expr.op).toBe('$multiply');
  });

  it('divide() creates $divide operator', () => {
    const expr = MongoAggOperator.divide(MongoAggFieldRef.of('total'), MongoAggLiteral.of(2));
    expect(expr.op).toBe('$divide');
  });

  it('concat() creates $concat operator', () => {
    const expr = MongoAggOperator.concat(
      MongoAggFieldRef.of('first'),
      MongoAggLiteral.of(' '),
      MongoAggFieldRef.of('last'),
    );
    expect(expr.op).toBe('$concat');
    expect(expr.args).toHaveLength(3);
  });

  it('toLower() creates $toLower operator with single arg', () => {
    const expr = MongoAggOperator.toLower(MongoAggFieldRef.of('name'));
    expect(expr.op).toBe('$toLower');
    expect(Array.isArray(expr.args)).toBe(false);
  });

  it('toUpper() creates $toUpper operator with single arg', () => {
    const expr = MongoAggOperator.toUpper(MongoAggFieldRef.of('name'));
    expect(expr.op).toBe('$toUpper');
  });

  it('size() creates $size operator with single arg', () => {
    const expr = MongoAggOperator.size(MongoAggFieldRef.of('items'));
    expect(expr.op).toBe('$size');
  });

  it('constructs with record args', () => {
    const expr = MongoAggOperator.of('$dateToString', {
      format: MongoAggLiteral.of('%Y-%m-%d'),
      date: MongoAggFieldRef.of('createdAt'),
    });
    expect(expr.kind).toBe('operator');
    expect(expr.op).toBe('$dateToString');
    expect(Array.isArray(expr.args)).toBe(false);
    const args = expr.args as Readonly<Record<string, MongoAggExpr>>;
    expect(Object.keys(args)).toEqual(['format', 'date']);
  });

  it('freezes record args', () => {
    const expr = MongoAggOperator.of('$dateToString', {
      format: MongoAggLiteral.of('%Y-%m-%d'),
      date: MongoAggFieldRef.of('createdAt'),
    });
    expect(Object.isFrozen(expr.args)).toBe(true);
  });
});

describe('MongoAggAccumulator', () => {
  it('constructs with op and arg', () => {
    const acc = MongoAggAccumulator.of('$sum', MongoAggFieldRef.of('amount'));
    expect(acc.kind).toBe('accumulator');
    expect(acc.op).toBe('$sum');
    expect(acc.arg).not.toBeNull();
  });

  it('constructs with null arg for $count', () => {
    const acc = MongoAggAccumulator.of('$count', null);
    expect(acc.op).toBe('$count');
    expect(acc.arg).toBeNull();
  });

  it('is frozen after construction', () => {
    const acc = MongoAggAccumulator.sum(MongoAggFieldRef.of('x'));
    expect(Object.isFrozen(acc)).toBe(true);
  });

  it.each([
    ['sum', '$sum'],
    ['avg', '$avg'],
    ['min', '$min'],
    ['max', '$max'],
    ['first', '$first'],
    ['last', '$last'],
    ['push', '$push'],
    ['addToSet', '$addToSet'],
    ['stdDevPop', '$stdDevPop'],
    ['stdDevSamp', '$stdDevSamp'],
  ] as const)('%s() sets op to %s', (method, expectedOp) => {
    const acc = MongoAggAccumulator[method](MongoAggFieldRef.of('x'));
    expect(acc.op).toBe(expectedOp);
    expect(acc.arg).not.toBeNull();
  });

  it('count() creates $count with null arg', () => {
    const acc = MongoAggAccumulator.count();
    expect(acc.op).toBe('$count');
    expect(acc.arg).toBeNull();
  });

  it('constructs with record arg', () => {
    const acc = MongoAggAccumulator.of('$topN', {
      output: MongoAggFieldRef.of('score'),
      sortBy: MongoAggLiteral.of({ score: -1 }),
      n: MongoAggLiteral.of(3),
    });
    expect(acc.kind).toBe('accumulator');
    expect(acc.op).toBe('$topN');
    const arg = acc.arg as Readonly<Record<string, MongoAggExpr>>;
    expect(Object.keys(arg)).toEqual(['output', 'sortBy', 'n']);
  });

  it('freezes record arg', () => {
    const acc = MongoAggAccumulator.of('$firstN', {
      input: MongoAggFieldRef.of('x'),
      n: MongoAggLiteral.of(5),
    });
    expect(Object.isFrozen(acc.arg)).toBe(true);
  });
});

describe('MongoAggCond', () => {
  it('constructs with condition, then, else', () => {
    const cond = MongoAggCond.of(
      MongoAggOperator.of('$gte', [MongoAggFieldRef.of('age'), MongoAggLiteral.of(18)]),
      MongoAggLiteral.of('adult'),
      MongoAggLiteral.of('minor'),
    );
    expect(cond.kind).toBe('cond');
    expect(cond.condition.kind).toBe('operator');
    expect(cond.then_.kind).toBe('literal');
    expect(cond.else_.kind).toBe('literal');
  });

  it('is frozen after construction', () => {
    const cond = MongoAggCond.of(
      MongoAggLiteral.of(true),
      MongoAggLiteral.of(1),
      MongoAggLiteral.of(0),
    );
    expect(Object.isFrozen(cond)).toBe(true);
  });
});

describe('MongoAggSwitch', () => {
  it('constructs with branches and default', () => {
    const sw = MongoAggSwitch.of(
      [
        {
          case_: MongoAggOperator.of('$eq', [
            MongoAggFieldRef.of('status'),
            MongoAggLiteral.of('active'),
          ]),
          then_: MongoAggLiteral.of('Active'),
        },
        {
          case_: MongoAggOperator.of('$eq', [
            MongoAggFieldRef.of('status'),
            MongoAggLiteral.of('pending'),
          ]),
          then_: MongoAggLiteral.of('Pending'),
        },
      ],
      MongoAggLiteral.of('Unknown'),
    );
    expect(sw.kind).toBe('switch');
    expect(sw.branches).toHaveLength(2);
    expect(sw.default_.kind).toBe('literal');
  });

  it('freezes branches array and each branch object', () => {
    const sw = MongoAggSwitch.of(
      [{ case_: MongoAggLiteral.of(true), then_: MongoAggLiteral.of(1) }],
      MongoAggLiteral.of(0),
    );
    expect(Object.isFrozen(sw)).toBe(true);
    expect(Object.isFrozen(sw.branches)).toBe(true);
    expect(Object.isFrozen(sw.branches[0])).toBe(true);
  });
});

describe('MongoAggArrayFilter', () => {
  it('constructs with input, cond, as', () => {
    const f = MongoAggArrayFilter.of(
      MongoAggFieldRef.of('scores'),
      MongoAggOperator.of('$gte', [MongoAggFieldRef.of('$score'), MongoAggLiteral.of(70)]),
      'score',
    );
    expect(f.kind).toBe('filter');
    expect(f.input.kind).toBe('fieldRef');
    expect(f.cond.kind).toBe('operator');
    expect(f.as).toBe('score');
  });

  it('is frozen after construction', () => {
    const f = MongoAggArrayFilter.of(
      MongoAggFieldRef.of('items'),
      MongoAggLiteral.of(true),
      'item',
    );
    expect(Object.isFrozen(f)).toBe(true);
  });
});

describe('MongoAggMap', () => {
  it('constructs with input, in, as', () => {
    const m = MongoAggMap.of(
      MongoAggFieldRef.of('items'),
      MongoAggOperator.multiply(
        MongoAggFieldRef.of('$item.price'),
        MongoAggFieldRef.of('$item.qty'),
      ),
      'item',
    );
    expect(m.kind).toBe('map');
    expect(m.input.kind).toBe('fieldRef');
    expect(m.in_.kind).toBe('operator');
    expect(m.as).toBe('item');
  });

  it('is frozen after construction', () => {
    const m = MongoAggMap.of(MongoAggFieldRef.of('x'), MongoAggLiteral.of(1), 'v');
    expect(Object.isFrozen(m)).toBe(true);
  });
});

describe('MongoAggReduce', () => {
  it('constructs with input, initialValue, in', () => {
    const r = MongoAggReduce.of(
      MongoAggFieldRef.of('items'),
      MongoAggLiteral.of(0),
      MongoAggOperator.add(MongoAggFieldRef.of('$value'), MongoAggFieldRef.of('$this')),
    );
    expect(r.kind).toBe('reduce');
    expect(r.input.kind).toBe('fieldRef');
    expect(r.initialValue.kind).toBe('literal');
    expect(r.in_.kind).toBe('operator');
  });

  it('is frozen after construction', () => {
    const r = MongoAggReduce.of(
      MongoAggFieldRef.of('x'),
      MongoAggLiteral.of(0),
      MongoAggLiteral.of(1),
    );
    expect(Object.isFrozen(r)).toBe(true);
  });
});

describe('MongoAggLet', () => {
  it('constructs with vars and in', () => {
    const l = MongoAggLet.of(
      {
        total: MongoAggOperator.add(MongoAggFieldRef.of('price'), MongoAggFieldRef.of('tax')),
        discount: MongoAggFieldRef.of('discountRate'),
      },
      MongoAggOperator.multiply(
        MongoAggFieldRef.of('$total'),
        MongoAggOperator.subtract(MongoAggLiteral.of(1), MongoAggFieldRef.of('$discount')),
      ),
    );
    expect(l.kind).toBe('let');
    expect(Object.keys(l.vars)).toEqual(['total', 'discount']);
    expect(l.in_.kind).toBe('operator');
  });

  it('freezes vars record', () => {
    const l = MongoAggLet.of({ x: MongoAggLiteral.of(1) }, MongoAggFieldRef.of('x'));
    expect(Object.isFrozen(l)).toBe(true);
    expect(Object.isFrozen(l.vars)).toBe(true);
  });
});

describe('MongoAggMergeObjects', () => {
  it('constructs with array of expressions', () => {
    const m = MongoAggMergeObjects.of([
      MongoAggFieldRef.of('defaults'),
      MongoAggFieldRef.of('overrides'),
    ]);
    expect(m.kind).toBe('mergeObjects');
    expect(m.exprs).toHaveLength(2);
  });

  it('freezes exprs array', () => {
    const m = MongoAggMergeObjects.of([MongoAggFieldRef.of('a')]);
    expect(Object.isFrozen(m)).toBe(true);
    expect(Object.isFrozen(m.exprs)).toBe(true);
  });
});

describe('MongoAggExprVisitor', () => {
  const kindVisitor: MongoAggExprVisitor<string> = {
    fieldRef: (expr) => `fieldRef:${expr.path}`,
    literal: (expr) => `literal:${String(expr.value)}`,
    operator: (expr) => `operator:${expr.op}`,
    accumulator: (expr) => `accumulator:${expr.op}`,
    cond: () => 'cond',
    switch_: (expr) => `switch:${expr.branches.length}`,
    filter: (expr) => `filter:${expr.as}`,
    map: (expr) => `map:${expr.as}`,
    reduce: () => 'reduce',
    let_: (expr) => `let:${Object.keys(expr.vars).join(',')}`,
    mergeObjects: (expr) => `mergeObjects:${expr.exprs.length}`,
  };

  it('dispatches fieldRef', () => {
    expect(MongoAggFieldRef.of('name').accept(kindVisitor)).toBe('fieldRef:name');
  });

  it('dispatches literal', () => {
    expect(MongoAggLiteral.of(42).accept(kindVisitor)).toBe('literal:42');
  });

  it('dispatches operator', () => {
    expect(
      MongoAggOperator.of('$add', [MongoAggLiteral.of(1), MongoAggLiteral.of(2)]).accept(
        kindVisitor,
      ),
    ).toBe('operator:$add');
  });

  it('dispatches accumulator', () => {
    expect(MongoAggAccumulator.sum(MongoAggFieldRef.of('x')).accept(kindVisitor)).toBe(
      'accumulator:$sum',
    );
  });

  it('dispatches cond', () => {
    expect(
      MongoAggCond.of(
        MongoAggLiteral.of(true),
        MongoAggLiteral.of(1),
        MongoAggLiteral.of(0),
      ).accept(kindVisitor),
    ).toBe('cond');
  });

  it('dispatches switch', () => {
    expect(
      MongoAggSwitch.of(
        [{ case_: MongoAggLiteral.of(true), then_: MongoAggLiteral.of(1) }],
        MongoAggLiteral.of(0),
      ).accept(kindVisitor),
    ).toBe('switch:1');
  });

  it('dispatches filter', () => {
    expect(
      MongoAggArrayFilter.of(MongoAggFieldRef.of('arr'), MongoAggLiteral.of(true), 'elem').accept(
        kindVisitor,
      ),
    ).toBe('filter:elem');
  });

  it('dispatches map', () => {
    expect(
      MongoAggMap.of(MongoAggFieldRef.of('arr'), MongoAggFieldRef.of('v'), 'v').accept(kindVisitor),
    ).toBe('map:v');
  });

  it('dispatches reduce', () => {
    expect(
      MongoAggReduce.of(
        MongoAggFieldRef.of('arr'),
        MongoAggLiteral.of(0),
        MongoAggLiteral.of(1),
      ).accept(kindVisitor),
    ).toBe('reduce');
  });

  it('dispatches let', () => {
    expect(
      MongoAggLet.of(
        { x: MongoAggLiteral.of(1), y: MongoAggLiteral.of(2) },
        MongoAggFieldRef.of('x'),
      ).accept(kindVisitor),
    ).toBe('let:x,y');
  });

  it('dispatches mergeObjects', () => {
    expect(
      MongoAggMergeObjects.of([MongoAggFieldRef.of('a'), MongoAggFieldRef.of('b')]).accept(
        kindVisitor,
      ),
    ).toBe('mergeObjects:2');
  });
});

describe('MongoAggExprRewriter', () => {
  it('returns identical structure with empty rewriter', () => {
    const rewriter: MongoAggExprRewriter = {};
    const original = MongoAggFieldRef.of('name');
    expect(original.rewrite(rewriter)).toBe(original);
  });

  it('applies fieldRef hook', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`prefixed.${expr.path}`),
    };
    const result = MongoAggFieldRef.of('name').rewrite(rewriter);
    expect(result.kind).toBe('fieldRef');
    expect((result as MongoAggFieldRef).path).toBe('prefixed.name');
  });

  it('leaves literal untouched with empty rewriter', () => {
    const rewriter: MongoAggExprRewriter = {};
    const original = MongoAggLiteral.of(42);
    expect(original.rewrite(rewriter)).toBe(original);
  });

  it('rewrites children of operator before applying hook', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`renamed.${expr.path}`),
    };
    const original = MongoAggOperator.add(MongoAggFieldRef.of('a'), MongoAggFieldRef.of('b'));
    const result = original.rewrite(rewriter) as MongoAggOperator;
    expect(result.kind).toBe('operator');
    const args = result.args as ReadonlyArray<MongoAggExpr>;
    expect((args[0] as MongoAggFieldRef).path).toBe('renamed.a');
    expect((args[1] as MongoAggFieldRef).path).toBe('renamed.b');
  });

  it('rewrites single-arg operator children', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`x.${expr.path}`),
    };
    const original = MongoAggOperator.toLower(MongoAggFieldRef.of('name'));
    const result = original.rewrite(rewriter) as MongoAggOperator;
    expect((result.args as MongoAggFieldRef).path).toBe('x.name');
  });

  it('rewrites record-arg operator children', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`renamed.${expr.path}`),
    };
    const original = MongoAggOperator.of('$dateToString', {
      format: MongoAggLiteral.of('%Y-%m-%d'),
      date: MongoAggFieldRef.of('createdAt'),
    });
    const result = original.rewrite(rewriter) as MongoAggOperator;
    const args = result.args as Readonly<Record<string, MongoAggExpr>>;
    expect((args['date'] as MongoAggFieldRef).path).toBe('renamed.createdAt');
    expect((args['format'] as MongoAggLiteral).value).toBe('%Y-%m-%d');
  });

  it('rewrites accumulator arg', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: () => MongoAggFieldRef.of('replaced'),
    };
    const original = MongoAggAccumulator.sum(MongoAggFieldRef.of('amount'));
    const result = original.rewrite(rewriter) as MongoAggAccumulator;
    expect((result.arg as MongoAggFieldRef).path).toBe('replaced');
  });

  it('preserves null arg on accumulator rewrite', () => {
    const rewriter: MongoAggExprRewriter = {};
    const original = MongoAggAccumulator.count();
    const result = original.rewrite(rewriter) as MongoAggAccumulator;
    expect(result.arg).toBeNull();
  });

  it('rewrites record-arg accumulator children', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`renamed.${expr.path}`),
    };
    const original = MongoAggAccumulator.of('$firstN', {
      input: MongoAggFieldRef.of('score'),
      n: MongoAggLiteral.of(3),
    });
    const result = original.rewrite(rewriter) as MongoAggAccumulator;
    const arg = result.arg as Readonly<Record<string, MongoAggExpr>>;
    expect((arg['input'] as MongoAggFieldRef).path).toBe('renamed.score');
    expect((arg['n'] as MongoAggLiteral).value).toBe(3);
  });

  it('rewrites cond children bottom-up', () => {
    const rewriter: MongoAggExprRewriter = {
      literal: (expr) =>
        typeof expr.value === 'number' ? MongoAggLiteral.of(expr.value + 100) : expr,
    };
    const original = MongoAggCond.of(
      MongoAggLiteral.of(true),
      MongoAggLiteral.of(1),
      MongoAggLiteral.of(0),
    );
    const result = original.rewrite(rewriter) as MongoAggCond;
    expect((result.condition as MongoAggLiteral).value).toBe(true);
    expect((result.then_ as MongoAggLiteral).value).toBe(101);
    expect((result.else_ as MongoAggLiteral).value).toBe(100);
  });

  it('rewrites switch branches and default', () => {
    const rewriter: MongoAggExprRewriter = {
      literal: () => MongoAggLiteral.of('rewritten'),
    };
    const original = MongoAggSwitch.of(
      [{ case_: MongoAggLiteral.of(true), then_: MongoAggLiteral.of('A') }],
      MongoAggLiteral.of('B'),
    );
    const result = original.rewrite(rewriter) as MongoAggSwitch;
    expect((result.branches[0]!.case_ as MongoAggLiteral).value).toBe('rewritten');
    expect((result.branches[0]!.then_ as MongoAggLiteral).value).toBe('rewritten');
    expect((result.default_ as MongoAggLiteral).value).toBe('rewritten');
  });

  it('rewrites filter input and cond', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: () => MongoAggFieldRef.of('replaced'),
    };
    const original = MongoAggArrayFilter.of(
      MongoAggFieldRef.of('items'),
      MongoAggFieldRef.of('cond'),
      'item',
    );
    const result = original.rewrite(rewriter) as MongoAggArrayFilter;
    expect((result.input as MongoAggFieldRef).path).toBe('replaced');
    expect((result.cond as MongoAggFieldRef).path).toBe('replaced');
    expect(result.as).toBe('item');
  });

  it('rewrites map input and in', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: () => MongoAggFieldRef.of('replaced'),
    };
    const original = MongoAggMap.of(
      MongoAggFieldRef.of('items'),
      MongoAggFieldRef.of('expr'),
      'item',
    );
    const result = original.rewrite(rewriter) as MongoAggMap;
    expect((result.input as MongoAggFieldRef).path).toBe('replaced');
    expect((result.in_ as MongoAggFieldRef).path).toBe('replaced');
  });

  it('rewrites reduce input, initialValue, and in', () => {
    const rewriter: MongoAggExprRewriter = {
      literal: () => MongoAggLiteral.of(999),
    };
    const original = MongoAggReduce.of(
      MongoAggLiteral.of(1),
      MongoAggLiteral.of(2),
      MongoAggLiteral.of(3),
    );
    const result = original.rewrite(rewriter) as MongoAggReduce;
    expect((result.input as MongoAggLiteral).value).toBe(999);
    expect((result.initialValue as MongoAggLiteral).value).toBe(999);
    expect((result.in_ as MongoAggLiteral).value).toBe(999);
  });

  it('rewrites let vars and in', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: () => MongoAggFieldRef.of('replaced'),
    };
    const original = MongoAggLet.of({ x: MongoAggFieldRef.of('a') }, MongoAggFieldRef.of('b'));
    const result = original.rewrite(rewriter) as MongoAggLet;
    expect((result.vars['x'] as MongoAggFieldRef).path).toBe('replaced');
    expect((result.in_ as MongoAggFieldRef).path).toBe('replaced');
  });

  it('rewrites mergeObjects exprs', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: () => MongoAggFieldRef.of('replaced'),
    };
    const original = MongoAggMergeObjects.of([MongoAggFieldRef.of('a'), MongoAggFieldRef.of('b')]);
    const result = original.rewrite(rewriter) as MongoAggMergeObjects;
    expect((result.exprs[0] as MongoAggFieldRef).path).toBe('replaced');
    expect((result.exprs[1] as MongoAggFieldRef).path).toBe('replaced');
  });

  it('rewrites deeply nested expressions', () => {
    const rewriter: MongoAggExprRewriter = {
      fieldRef: (expr) => MongoAggFieldRef.of(`deep.${expr.path}`),
    };
    const original = MongoAggCond.of(
      MongoAggOperator.of('$gt', [MongoAggFieldRef.of('x'), MongoAggLiteral.of(0)]),
      MongoAggOperator.add(MongoAggFieldRef.of('a'), MongoAggFieldRef.of('b')),
      MongoAggLiteral.of(0),
    );
    const result = original.rewrite(rewriter) as MongoAggCond;
    const condOp = result.condition as MongoAggOperator;
    const condArgs = condOp.args as ReadonlyArray<MongoAggExpr>;
    expect((condArgs[0] as MongoAggFieldRef).path).toBe('deep.x');
    const thenOp = result.then_ as MongoAggOperator;
    const thenArgs = thenOp.args as ReadonlyArray<MongoAggExpr>;
    expect((thenArgs[0] as MongoAggFieldRef).path).toBe('deep.a');
    expect((thenArgs[1] as MongoAggFieldRef).path).toBe('deep.b');
  });
});
