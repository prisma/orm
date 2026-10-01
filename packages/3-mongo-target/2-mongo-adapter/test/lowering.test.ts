import { type CodecCallContext, decodeJsonString } from '@internal/framework-components/codec';
import { mongoCodec, newMongoCodecRegistry } from '@internal/mongo-codec';
import {
  MongoAddFieldsStage,
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
  MongoAndExpr,
  MongoBucketAutoStage,
  MongoBucketStage,
  MongoCountStage,
  MongoDensifyStage,
  MongoExistsExpr,
  MongoExprFilter,
  MongoFacetStage,
  MongoFieldFilter,
  MongoFillStage,
  MongoGeoNearStage,
  MongoGraphLookupStage,
  MongoGroupStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoMergeStage,
  MongoNotExpr,
  MongoOrExpr,
  MongoOutStage,
  MongoProjectStage,
  MongoRedactStage,
  MongoReplaceRootStage,
  MongoSampleStage,
  MongoSearchMetaStage,
  MongoSearchStage,
  MongoSetWindowFieldsStage,
  MongoSkipStage,
  MongoSortByCountStage,
  MongoSortStage,
  MongoUnionWithStage,
  MongoUnwindStage,
  MongoVectorSearchStage,
} from '@internal/mongo-query-ast/execution';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { lowerAggExpr, lowerFilter, lowerPipeline, lowerStage } from '../src/lowering';

// Default fixtures: tests that don't exercise codecs use an empty registry and an empty ctx. Tests that need codec encoding shadow `registry` locally.
const registry = newMongoCodecRegistry();
const ctx: CodecCallContext = {};

describe('lowerFilter', () => {
  it('lowers MongoFieldFilter with $eq', async () => {
    const filter = MongoFieldFilter.eq('email', 'alice@example.com');
    expect(await lowerFilter(filter, registry, ctx)).toEqual({
      email: { $eq: 'alice@example.com' },
    });
  });

  it('lowers MongoFieldFilter with $gt', async () => {
    expect(await lowerFilter(MongoFieldFilter.gt('age', 18), registry, ctx)).toEqual({
      age: { $gt: 18 },
    });
  });

  it('lowers MongoFieldFilter with arbitrary operator', async () => {
    expect(await lowerFilter(MongoFieldFilter.of('loc', '$near', [1, 2]), registry, ctx)).toEqual({
      loc: { $near: [1, 2] },
    });
  });

  it('lowers MongoAndExpr', async () => {
    const and = MongoAndExpr.of([MongoFieldFilter.eq('x', 1), MongoFieldFilter.gt('y', 2)]);
    expect(await lowerFilter(and, registry, ctx)).toEqual({
      $and: [{ x: { $eq: 1 } }, { y: { $gt: 2 } }],
    });
  });

  it('lowers MongoOrExpr', async () => {
    const or = MongoOrExpr.of([
      MongoFieldFilter.eq('status', 'active'),
      MongoFieldFilter.eq('status', 'pending'),
    ]);
    expect(await lowerFilter(or, registry, ctx)).toEqual({
      $or: [{ status: { $eq: 'active' } }, { status: { $eq: 'pending' } }],
    });
  });

  it('lowers MongoNotExpr to $nor', async () => {
    const not = new MongoNotExpr(MongoFieldFilter.eq('x', 1));
    expect(await lowerFilter(not, registry, ctx)).toEqual({ $nor: [{ x: { $eq: 1 } }] });
  });

  it('lowers MongoExistsExpr (true)', async () => {
    expect(await lowerFilter(MongoExistsExpr.exists('name'), registry, ctx)).toEqual({
      name: { $exists: true },
    });
  });

  it('lowers MongoExistsExpr (false)', async () => {
    expect(await lowerFilter(MongoExistsExpr.notExists('name'), registry, ctx)).toEqual({
      name: { $exists: false },
    });
  });

  it('lowers nested composite filters', async () => {
    const filter = MongoAndExpr.of([
      MongoOrExpr.of([MongoFieldFilter.eq('x', 1), MongoFieldFilter.eq('x', 2)]),
      new MongoNotExpr(MongoFieldFilter.gt('y', 10)),
    ]);
    expect(await lowerFilter(filter, registry, ctx)).toEqual({
      $and: [{ $or: [{ x: { $eq: 1 } }, { x: { $eq: 2 } }] }, { $nor: [{ y: { $gt: 10 } }] }],
    });
  });

  it('resolves MongoParamRef values during lowering', async () => {
    const param = MongoParamRef.of('alice@example.com', { name: 'email' });
    const filter = MongoFieldFilter.eq('email', param);
    expect(await lowerFilter(filter, registry, ctx)).toEqual({
      email: { $eq: 'alice@example.com' },
    });
  });

  it('lowers MongoFieldFilter.isNull', async () => {
    expect(await lowerFilter(MongoFieldFilter.isNull('bio'), registry, ctx)).toEqual({
      bio: { $eq: null },
    });
  });

  it('lowers MongoFieldFilter.isNotNull', async () => {
    expect(await lowerFilter(MongoFieldFilter.isNotNull('bio'), registry, ctx)).toEqual({
      bio: { $ne: null },
    });
  });

  it('resolves nested MongoParamRef in document values', async () => {
    const param = MongoParamRef.of(42);
    const filter = MongoFieldFilter.of('data', '$elemMatch', { value: param });
    expect(await lowerFilter(filter, registry, ctx)).toEqual({
      data: { $elemMatch: { value: 42 } },
    });
  });

  it('encodes MongoParamRef field-filter values via the codec registry when provided', async () => {
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/uppercase@1',
        decode: (wire: string) => wire,
        encode: (value: string) => value.toUpperCase(),
        decodeJson: (json) => decodeJsonString('test/uppercase@1', json),
      }),
    );

    const param = MongoParamRef.of('alice', { codecId: 'test/uppercase@1' });
    const filter = MongoFieldFilter.eq('email', param);

    expect(await lowerFilter(filter, registry, ctx)).toEqual({ email: { $eq: 'ALICE' } });
  });

  it('forwards the codec registry through composite filters', async () => {
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/uppercase@1',
        decode: (wire: string) => wire,
        encode: (value: string) => value.toUpperCase(),
        decodeJson: (json) => decodeJsonString('test/uppercase@1', json),
      }),
    );

    const filter = MongoAndExpr.of([
      MongoFieldFilter.eq('a', MongoParamRef.of('a', { codecId: 'test/uppercase@1' })),
      MongoOrExpr.of([
        MongoFieldFilter.eq('b', MongoParamRef.of('b', { codecId: 'test/uppercase@1' })),
        new MongoNotExpr(
          MongoFieldFilter.eq('c', MongoParamRef.of('c', { codecId: 'test/uppercase@1' })),
        ),
      ]),
    ]);

    expect(await lowerFilter(filter, registry, ctx)).toEqual({
      $and: [{ a: { $eq: 'A' } }, { $or: [{ b: { $eq: 'B' } }, { $nor: [{ c: { $eq: 'C' } }] }] }],
    });
  });

  it('passes the registry through $match in a pipeline', async () => {
    const registry = newMongoCodecRegistry();
    registry.register(
      mongoCodec({
        typeId: 'test/uppercase@1',
        decode: (wire: string) => wire,
        encode: (value: string) => value.toUpperCase(),
        decodeJson: (json) => decodeJsonString('test/uppercase@1', json),
      }),
    );

    const matchStage = new MongoMatchStage(
      MongoFieldFilter.eq('email', MongoParamRef.of('alice', { codecId: 'test/uppercase@1' })),
    );

    expect(await lowerStage(matchStage, registry, ctx)).toEqual({
      $match: { email: { $eq: 'ALICE' } },
    });
    expect(await lowerPipeline([matchStage], registry, ctx)).toEqual([
      { $match: { email: { $eq: 'ALICE' } } },
    ]);
  });

  it('lowers MongoExprFilter to $expr with aggregation expression', async () => {
    const filter = MongoExprFilter.of(
      MongoAggOperator.of('$gt', [MongoAggFieldRef.of('qty'), MongoAggFieldRef.of('minQty')]),
    );
    expect(await lowerFilter(filter, registry, ctx)).toEqual({
      $expr: { $gt: ['$qty', '$minQty'] },
    });
  });

  it('lowers MongoExprFilter with nested arithmetic', async () => {
    const filter = MongoExprFilter.of(
      MongoAggOperator.of('$gt', [
        MongoAggFieldRef.of('price'),
        MongoAggOperator.multiply(MongoAggFieldRef.of('discount'), MongoAggLiteral.of(2)),
      ]),
    );
    expect(await lowerFilter(filter, registry, ctx)).toEqual({
      $expr: { $gt: ['$price', { $multiply: ['$discount', 2] }] },
    });
  });
});

describe('lowerStage', () => {
  it('lowers $match stage', async () => {
    const stage = new MongoMatchStage(MongoFieldFilter.eq('x', 1));
    expect(await lowerStage(stage, registry, ctx)).toEqual({ $match: { x: { $eq: 1 } } });
  });

  it('lowers $project stage', async () => {
    const stage = new MongoProjectStage({ name: 1, email: 1, _id: 0 });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $project: { name: 1, email: 1, _id: 0 },
    });
  });

  it('lowers $sort stage', async () => {
    const stage = new MongoSortStage({ age: -1, name: 1 });
    expect(await lowerStage(stage, registry, ctx)).toEqual({ $sort: { age: -1, name: 1 } });
  });

  it('lowers $limit stage', async () => {
    expect(await lowerStage(new MongoLimitStage(10), registry, ctx)).toEqual({ $limit: 10 });
  });

  it('lowers $skip stage', async () => {
    expect(await lowerStage(new MongoSkipStage(5), registry, ctx)).toEqual({ $skip: 5 });
  });

  it('lowers $lookup stage without pipeline', async () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'userPosts',
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: 'authorId',
        as: 'userPosts',
      },
    });
  });

  it('lowers $lookup stage with nested pipeline', async () => {
    const stage = new MongoLookupStage({
      from: 'posts',
      localField: '_id',
      foreignField: 'authorId',
      as: 'userPosts',
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('published', true))],
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $lookup: {
        from: 'posts',
        localField: '_id',
        foreignField: 'authorId',
        as: 'userPosts',
        pipeline: [{ $match: { published: { $eq: true } } }],
      },
    });
  });

  it('lowers $unwind stage', async () => {
    const stage = new MongoUnwindStage('$posts', true);
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $unwind: { path: '$posts', preserveNullAndEmptyArrays: true },
    });
  });

  it('lowers $unwind stage with includeArrayIndex', async () => {
    const stage = new MongoUnwindStage('$items', false, 'itemIndex');
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $unwind: {
        path: '$items',
        preserveNullAndEmptyArrays: false,
        includeArrayIndex: 'itemIndex',
      },
    });
  });

  it('lowers $group stage with single field groupId', async () => {
    const stage = new MongoGroupStage(MongoAggFieldRef.of('department'), {
      total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')),
      count: MongoAggAccumulator.count(),
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $group: {
        _id: '$department',
        total: { $sum: '$amount' },
        count: { $count: {} },
      },
    });
  });

  it('lowers $group stage with null groupId', async () => {
    const stage = new MongoGroupStage(null, {
      total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')),
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $group: { _id: null, total: { $sum: '$amount' } },
    });
  });

  it('lowers $group stage with compound groupId', async () => {
    const stage = new MongoGroupStage(
      {
        dept: MongoAggFieldRef.of('department'),
        year: MongoAggFieldRef.of('year'),
      },
      { total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')) },
    );
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $group: {
        _id: { dept: '$department', year: '$year' },
        total: { $sum: '$amount' },
      },
    });
  });

  it('lowers $group stage with compound groupId containing a "kind" key', async () => {
    const stage = new MongoGroupStage(
      {
        kind: MongoAggFieldRef.of('type'),
        dept: MongoAggFieldRef.of('department'),
      },
      { total: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')) },
    );
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $group: {
        _id: { kind: '$type', dept: '$department' },
        total: { $sum: '$amount' },
      },
    });
  });

  it('lowers $addFields stage', async () => {
    const stage = new MongoAddFieldsStage({
      fullName: MongoAggOperator.of('$concat', [
        MongoAggFieldRef.of('first'),
        MongoAggLiteral.of(' '),
        MongoAggFieldRef.of('last'),
      ]),
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $addFields: {
        fullName: { $concat: ['$first', ' ', '$last'] },
      },
    });
  });

  it('lowers $replaceRoot stage', async () => {
    const stage = new MongoReplaceRootStage(MongoAggFieldRef.of('address'));
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $replaceRoot: { newRoot: '$address' },
    });
  });

  it('lowers $count stage', async () => {
    const stage = new MongoCountStage('totalDocs');
    expect(await lowerStage(stage, registry, ctx)).toEqual({ $count: 'totalDocs' });
  });

  it('lowers $sortByCount stage', async () => {
    const stage = new MongoSortByCountStage(MongoAggFieldRef.of('status'));
    expect(await lowerStage(stage, registry, ctx)).toEqual({ $sortByCount: '$status' });
  });

  it('lowers $sample stage', async () => {
    const stage = new MongoSampleStage(10);
    expect(await lowerStage(stage, registry, ctx)).toEqual({ $sample: { size: 10 } });
  });

  it('lowers $redact stage', async () => {
    const stage = new MongoRedactStage(
      MongoAggCond.of(
        MongoAggOperator.of('$eq', [MongoAggFieldRef.of('level'), MongoAggLiteral.of(5)]),
        MongoAggLiteral.of('$$PRUNE'),
        MongoAggLiteral.of('$$DESCEND'),
      ),
    );
    const thenKey = 'then';
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $redact: {
        $cond: Object.fromEntries([
          ['if', { $eq: ['$level', 5] }],
          [thenKey, { $literal: '$$PRUNE' }],
          ['else', { $literal: '$$DESCEND' }],
        ]),
      },
    });
  });

  it('lowers $project stage with computed projections', async () => {
    const stage = new MongoProjectStage({
      fullName: MongoAggOperator.of('$concat', [
        MongoAggFieldRef.of('first'),
        MongoAggLiteral.of(' '),
        MongoAggFieldRef.of('last'),
      ]),
      email: 1,
      _id: 0,
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $project: {
        fullName: { $concat: ['$first', ' ', '$last'] },
        email: 1,
        _id: 0,
      },
    });
  });

  it('lowers $lookup stage with let_ and pipeline', async () => {
    const stage = new MongoLookupStage({
      from: 'orders',
      as: 'matchingOrders',
      let_: { userId: MongoAggFieldRef.of('_id') },
      pipeline: [new MongoMatchStage(MongoFieldFilter.eq('status', 'active'))],
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $lookup: {
        from: 'orders',
        as: 'matchingOrders',
        let: { userId: '$_id' },
        pipeline: [{ $match: { status: { $eq: 'active' } } }],
      },
    });
  });
});

describe('lowerAggExpr', () => {
  it('lowers MongoAggFieldRef to $-prefixed string', () => {
    expect(lowerAggExpr(MongoAggFieldRef.of('name'))).toBe('$name');
  });

  it('lowers dotted field ref', () => {
    expect(lowerAggExpr(MongoAggFieldRef.of('address.city'))).toBe('$address.city');
  });

  it('lowers unambiguous literal directly', () => {
    expect(lowerAggExpr(MongoAggLiteral.of(42))).toBe(42);
  });

  it('lowers string literal directly when unambiguous', () => {
    expect(lowerAggExpr(MongoAggLiteral.of('hello'))).toBe('hello');
  });

  it('lowers null literal directly', () => {
    expect(lowerAggExpr(MongoAggLiteral.of(null))).toBe(null);
  });

  it('lowers boolean literal directly', () => {
    expect(lowerAggExpr(MongoAggLiteral.of(true))).toBe(true);
  });

  it('wraps $-prefixed string literal in $literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of('$ambiguous'))).toEqual({
      $literal: '$ambiguous',
    });
  });

  it('wraps a parameter in $literal, since its encoded value is only known once it is resolved', () => {
    const param = new MongoParamRef('plain', { codecId: 'mongo/string@1' });
    expect(lowerAggExpr(MongoAggLiteral.of(param))).toEqual({ $literal: param });
    expect(lowerAggExpr(MongoAggLiteral.of([param]))).toEqual({ $literal: [param] });
  });

  it('wraps object with $-prefixed keys in $literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of({ $foo: 1 }))).toEqual({
      $literal: { $foo: 1 },
    });
  });

  it('does not wrap plain object literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of({ key: 'value' }))).toEqual({ key: 'value' });
  });

  it('wraps array containing $-prefixed string in $literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of(['$qty']))).toEqual({
      $literal: ['$qty'],
    });
  });

  it('wraps object with $-prefixed value in $literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of({ label: '$qty' }))).toEqual({
      $literal: { label: '$qty' },
    });
  });

  it('wraps deeply nested $-prefixed string in $literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of({ a: { b: '$deep' } }))).toEqual({
      $literal: { a: { b: '$deep' } },
    });
  });

  it('does not wrap plain array literal', () => {
    expect(lowerAggExpr(MongoAggLiteral.of([1, 2, 3]))).toEqual([1, 2, 3]);
  });

  it('lowers array-arg operator', () => {
    expect(
      lowerAggExpr(MongoAggOperator.add(MongoAggFieldRef.of('price'), MongoAggFieldRef.of('tax'))),
    ).toEqual({ $add: ['$price', '$tax'] });
  });

  it('lowers single-arg operator', () => {
    expect(lowerAggExpr(MongoAggOperator.toLower(MongoAggFieldRef.of('name')))).toEqual({
      $toLower: '$name',
    });
  });

  it('lowers nested operator expression', () => {
    const expr = MongoAggOperator.multiply(
      MongoAggFieldRef.of('price'),
      MongoAggOperator.subtract(MongoAggLiteral.of(1), MongoAggFieldRef.of('discount')),
    );
    expect(lowerAggExpr(expr)).toEqual({
      $multiply: ['$price', { $subtract: [1, '$discount'] }],
    });
  });

  it('lowers accumulator with arg', () => {
    expect(lowerAggExpr(MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')))).toEqual({
      $sum: '$amount',
    });
  });

  it('lowers $count accumulator with null arg to empty object', () => {
    expect(lowerAggExpr(MongoAggAccumulator.count())).toEqual({ $count: {} });
  });

  it('lowers record-arg operator', () => {
    const expr = MongoAggOperator.of('$dateToString', {
      format: MongoAggLiteral.of('%Y-%m-%d'),
      date: MongoAggFieldRef.of('createdAt'),
    });
    expect(lowerAggExpr(expr)).toEqual({
      $dateToString: { format: '%Y-%m-%d', date: '$createdAt' },
    });
  });

  it('lowers record-arg operator with array values', () => {
    const expr = MongoAggOperator.of('$zip', {
      inputs: [MongoAggFieldRef.of('a'), MongoAggFieldRef.of('b')],
      useLongestLength: MongoAggLiteral.of(true),
    });
    expect(lowerAggExpr(expr)).toEqual({
      $zip: { inputs: ['$a', '$b'], useLongestLength: true },
    });
  });

  it('lowers record-arg accumulator', () => {
    const expr = MongoAggAccumulator.of('$topN', {
      output: MongoAggFieldRef.of('score'),
      sortBy: MongoAggLiteral.of({ score: -1 }),
      n: MongoAggLiteral.of(3),
    });
    expect(lowerAggExpr(expr)).toEqual({
      $topN: { output: '$score', sortBy: { score: -1 }, n: 3 },
    });
  });

  it('lowers $cond', () => {
    const expr = MongoAggCond.of(
      MongoAggOperator.of('$gte', [MongoAggFieldRef.of('age'), MongoAggLiteral.of(18)]),
      MongoAggLiteral.of('adult'),
      MongoAggLiteral.of('minor'),
    );
    const thenKey = 'then';
    expect(lowerAggExpr(expr)).toEqual({
      $cond: Object.fromEntries([
        ['if', { $gte: ['$age', 18] }],
        [thenKey, 'adult'],
        ['else', 'minor'],
      ]),
    });
  });

  it('lowers $switch', () => {
    const expr = MongoAggSwitch.of(
      [
        {
          case_: MongoAggOperator.of('$eq', [
            MongoAggFieldRef.of('status'),
            MongoAggLiteral.of('active'),
          ]),
          then_: MongoAggLiteral.of('Active'),
        },
      ],
      MongoAggLiteral.of('Unknown'),
    );
    const thenKey = 'then';
    expect(lowerAggExpr(expr)).toEqual({
      $switch: {
        branches: [
          Object.fromEntries([
            ['case', { $eq: ['$status', 'active'] }],
            [thenKey, 'Active'],
          ]),
        ],
        default: 'Unknown',
      },
    });
  });

  it('lowers $filter', () => {
    const expr = MongoAggArrayFilter.of(
      MongoAggFieldRef.of('scores'),
      MongoAggOperator.of('$gte', [MongoAggFieldRef.of('$score'), MongoAggLiteral.of(70)]),
      'score',
    );
    expect(lowerAggExpr(expr)).toEqual({
      $filter: {
        input: '$scores',
        cond: { $gte: ['$$score', 70] },
        as: 'score',
      },
    });
  });

  it('lowers $map', () => {
    const expr = MongoAggMap.of(
      MongoAggFieldRef.of('items'),
      MongoAggOperator.multiply(
        MongoAggFieldRef.of('$item.price'),
        MongoAggFieldRef.of('$item.qty'),
      ),
      'item',
    );
    expect(lowerAggExpr(expr)).toEqual({
      $map: {
        input: '$items',
        in: { $multiply: ['$$item.price', '$$item.qty'] },
        as: 'item',
      },
    });
  });

  it('lowers $reduce', () => {
    const expr = MongoAggReduce.of(
      MongoAggFieldRef.of('items'),
      MongoAggLiteral.of(0),
      MongoAggOperator.add(MongoAggFieldRef.of('$value'), MongoAggFieldRef.of('$this')),
    );
    expect(lowerAggExpr(expr)).toEqual({
      $reduce: {
        input: '$items',
        initialValue: 0,
        in: { $add: ['$$value', '$$this'] },
      },
    });
  });

  it('lowers $let', () => {
    const expr = MongoAggLet.of(
      {
        total: MongoAggOperator.add(MongoAggFieldRef.of('price'), MongoAggFieldRef.of('tax')),
      },
      MongoAggOperator.multiply(
        MongoAggFieldRef.of('$total'),
        MongoAggOperator.subtract(MongoAggLiteral.of(1), MongoAggFieldRef.of('discount')),
      ),
    );
    expect(lowerAggExpr(expr)).toEqual({
      $let: {
        vars: { total: { $add: ['$price', '$tax'] } },
        in: { $multiply: ['$$total', { $subtract: [1, '$discount'] }] },
      },
    });
  });

  it('lowers $mergeObjects', () => {
    const expr = MongoAggMergeObjects.of([
      MongoAggFieldRef.of('defaults'),
      MongoAggFieldRef.of('overrides'),
    ]);
    expect(lowerAggExpr(expr)).toEqual({
      $mergeObjects: ['$defaults', '$overrides'],
    });
  });
});

describe('lowerStage — new stages', () => {
  it('lowers $out with collection only', async () => {
    expect(await lowerStage(new MongoOutStage('results'), registry, ctx)).toEqual({
      $out: 'results',
    });
  });

  it('lowers $out with db and collection', async () => {
    expect(await lowerStage(new MongoOutStage('results', 'archive'), registry, ctx)).toEqual({
      $out: { db: 'archive', coll: 'results' },
    });
  });

  it('lowers $unionWith without pipeline', async () => {
    expect(await lowerStage(new MongoUnionWithStage('other'), registry, ctx)).toEqual({
      $unionWith: { coll: 'other' },
    });
  });

  it('lowers $unionWith with pipeline', async () => {
    const stage = new MongoUnionWithStage('other', [
      new MongoMatchStage(MongoFieldFilter.eq('status', 'active')),
    ]);
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $unionWith: {
        coll: 'other',
        pipeline: [{ $match: { status: { $eq: 'active' } } }],
      },
    });
  });

  it('lowers $bucket', async () => {
    const stage = new MongoBucketStage({
      groupBy: MongoAggFieldRef.of('price'),
      boundaries: [0, 100, 500],
      default_: 'Other',
      output: { count: MongoAggAccumulator.sum(MongoAggLiteral.of(1)) },
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $bucket: {
        groupBy: '$price',
        boundaries: [0, 100, 500],
        default: 'Other',
        output: { count: { $sum: 1 } },
      },
    });
  });

  it('lowers $bucketAuto', async () => {
    const stage = new MongoBucketAutoStage({
      groupBy: MongoAggFieldRef.of('price'),
      buckets: 5,
      granularity: 'R10',
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $bucketAuto: { groupBy: '$price', buckets: 5, granularity: 'R10' },
    });
  });

  it('lowers $geoNear', async () => {
    const stage = new MongoGeoNearStage({
      near: { type: 'Point', coordinates: [-73.99, 40.73] },
      distanceField: 'dist.calculated',
      spherical: true,
      maxDistance: 5000,
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $geoNear: {
        near: { type: 'Point', coordinates: [-73.99, 40.73] },
        distanceField: 'dist.calculated',
        spherical: true,
        maxDistance: 5000,
      },
    });
  });

  it('lowers $geoNear with query filter', async () => {
    const stage = new MongoGeoNearStage({
      near: [0, 0],
      distanceField: 'dist',
      query: MongoFieldFilter.eq('active', true),
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $geoNear: {
        near: [0, 0],
        distanceField: 'dist',
        query: { active: { $eq: true } },
      },
    });
  });

  it('lowers $geoNear with all optional fields', async () => {
    const stage = new MongoGeoNearStage({
      near: { type: 'Point', coordinates: [0, 0] },
      distanceField: 'dist',
      minDistance: 100,
      key: 'location',
      distanceMultiplier: 0.001,
      includeLocs: 'loc',
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $geoNear: {
        near: { type: 'Point', coordinates: [0, 0] },
        distanceField: 'dist',
        minDistance: 100,
        key: 'location',
        distanceMultiplier: 0.001,
        includeLocs: 'loc',
      },
    });
  });

  it('lowers $facet', async () => {
    const stage = new MongoFacetStage({
      priceStats: [
        new MongoGroupStage(null, { avg: MongoAggAccumulator.avg(MongoAggFieldRef.of('price')) }),
      ],
      countByStatus: [new MongoSortByCountStage(MongoAggFieldRef.of('status'))],
    });
    const lowered = await lowerStage(stage, registry, ctx);
    expect(lowered).toEqual({
      $facet: {
        priceStats: [{ $group: { _id: null, avg: { $avg: '$price' } } }],
        countByStatus: [{ $sortByCount: '$status' }],
      },
    });
  });

  it('lowers $graphLookup', async () => {
    const stage = new MongoGraphLookupStage({
      from: 'employees',
      startWith: MongoAggFieldRef.of('reportsTo'),
      connectFromField: 'reportsTo',
      connectToField: 'name',
      as: 'hierarchy',
      maxDepth: 3,
      depthField: 'depth',
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $graphLookup: {
        from: 'employees',
        startWith: '$reportsTo',
        connectFromField: 'reportsTo',
        connectToField: 'name',
        as: 'hierarchy',
        maxDepth: 3,
        depthField: 'depth',
      },
    });
  });

  it('lowers $graphLookup with restrictSearchWithMatch', async () => {
    const stage = new MongoGraphLookupStage({
      from: 'e',
      startWith: MongoAggFieldRef.of('mgr'),
      connectFromField: 'mgr',
      connectToField: 'name',
      as: 'h',
      restrictSearchWithMatch: MongoFieldFilter.eq('active', true),
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $graphLookup: {
        from: 'e',
        startWith: '$mgr',
        connectFromField: 'mgr',
        connectToField: 'name',
        as: 'h',
        restrictSearchWithMatch: { active: { $eq: true } },
      },
    });
  });

  it('lowers $merge with string into', async () => {
    expect(await lowerStage(new MongoMergeStage({ into: 'output' }), registry, ctx)).toEqual({
      $merge: { into: 'output' },
    });
  });

  it('lowers $merge with object into and whenMatched pipeline', async () => {
    const stage = new MongoMergeStage({
      into: { db: 'archive', coll: 'results' },
      on: '_id',
      whenMatched: [new MongoAddFieldsStage({ updated: MongoAggLiteral.of(true) })],
      whenNotMatched: 'insert',
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $merge: {
        into: { db: 'archive', coll: 'results' },
        on: '_id',
        whenMatched: [{ $addFields: { updated: true } }],
        whenNotMatched: 'insert',
      },
    });
  });

  it('lowers $merge with string whenMatched', async () => {
    const stage = new MongoMergeStage({ into: 'output', whenMatched: 'replace' });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $merge: { into: 'output', whenMatched: 'replace' },
    });
  });

  it('lowers $setWindowFields', async () => {
    const stage = new MongoSetWindowFieldsStage({
      partitionBy: MongoAggFieldRef.of('state'),
      sortBy: { orderDate: 1 },
      output: {
        cumTotal: {
          operator: MongoAggAccumulator.sum(MongoAggFieldRef.of('quantity')),
          window: { documents: [Number.NEGATIVE_INFINITY, 0] as [number, number] },
        },
      },
    });
    const lowered = await lowerStage(stage, registry, ctx);
    expect(lowered).toEqual({
      $setWindowFields: {
        partitionBy: '$state',
        sortBy: { orderDate: 1 },
        output: {
          cumTotal: {
            $sum: '$quantity',
            window: { documents: [Number.NEGATIVE_INFINITY, 0] },
          },
        },
      },
    });
  });

  it('throws when $setWindowFields operator lowers to non-object', async () => {
    const stage = new MongoSetWindowFieldsStage({
      sortBy: { ts: 1 },
      output: {
        bad: { operator: MongoAggFieldRef.of('x') },
      },
    });
    await expect(lowerStage(stage, registry, ctx)).rejects.toThrow(
      'Window field operator must lower to an object',
    );
  });

  it('lowers $densify', async () => {
    const stage = new MongoDensifyStage({
      field: 'timestamp',
      partitionByFields: ['sensorId'],
      range: { step: 1, unit: 'hour', bounds: 'full' },
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $densify: {
        field: 'timestamp',
        partitionByFields: ['sensorId'],
        range: { step: 1, unit: 'hour', bounds: 'full' },
      },
    });
  });

  it('lowers $fill with method', async () => {
    const stage = new MongoFillStage({
      sortBy: { ts: 1 },
      output: { qty: { method: 'linear' } },
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $fill: {
        sortBy: { ts: 1 },
        output: { qty: { method: 'linear' } },
      },
    });
  });

  it('lowers $fill with value expression', async () => {
    const stage = new MongoFillStage({
      partitionBy: MongoAggFieldRef.of('region'),
      output: { price: { value: MongoAggLiteral.of(0) } },
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $fill: {
        partitionBy: '$region',
        output: { price: { value: 0 } },
      },
    });
  });

  it('lowers $search', async () => {
    const stage = new MongoSearchStage({ text: { query: 'hello', path: 'body' } }, 'myIndex');
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $search: { index: 'myIndex', text: { query: 'hello', path: 'body' } },
    });
  });

  it('lowers $searchMeta', async () => {
    const stage = new MongoSearchMetaStage({ facet: { operator: {} } });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $searchMeta: { facet: { operator: {} } },
    });
  });

  it('lowers $vectorSearch', async () => {
    const stage = new MongoVectorSearchStage({
      index: 'vec_idx',
      path: 'embedding',
      queryVector: [0.1, 0.2, 0.3],
      numCandidates: 100,
      limit: 10,
      filter: { genre: 'drama' },
    });
    expect(await lowerStage(stage, registry, ctx)).toEqual({
      $vectorSearch: {
        index: 'vec_idx',
        path: 'embedding',
        queryVector: [0.1, 0.2, 0.3],
        numCandidates: 100,
        limit: 10,
        filter: { genre: 'drama' },
      },
    });
  });
});

describe('lowerPipeline', () => {
  it('lowers a full pipeline to MongoDB driver format', async () => {
    const stages = [
      new MongoMatchStage(
        MongoAndExpr.of([MongoFieldFilter.eq('status', 'active'), MongoFieldFilter.gte('age', 18)]),
      ),
      new MongoLookupStage({
        from: 'posts',
        localField: '_id',
        foreignField: 'authorId',
        as: 'posts',
      }),
      new MongoUnwindStage('$posts', true),
      new MongoSortStage({ createdAt: -1 }),
      new MongoSkipStage(10),
      new MongoLimitStage(5),
      new MongoProjectStage({ name: 1, email: 1, posts: 1 }),
    ];

    const lowered = await lowerPipeline(stages, registry, ctx);
    expect(lowered).toEqual([
      {
        $match: {
          $and: [{ status: { $eq: 'active' } }, { age: { $gte: 18 } }],
        },
      },
      {
        $lookup: {
          from: 'posts',
          localField: '_id',
          foreignField: 'authorId',
          as: 'posts',
        },
      },
      { $unwind: { path: '$posts', preserveNullAndEmptyArrays: true } },
      { $sort: { createdAt: -1 } },
      { $skip: 10 },
      { $limit: 5 },
      { $project: { name: 1, email: 1, posts: 1 } },
    ]);
  });
});
