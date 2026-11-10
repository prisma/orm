import { assertType, expectTypeOf, test } from 'vitest';
import type { MongoMatchStage, MongoPipelineStage } from '../src/stages';
import type { MongoStageVisitor } from '../src/visitors';

test('switching on kind is exhaustive', () => {
  function exhaustiveSwitch(stage: MongoPipelineStage): string {
    switch (stage.kind) {
      case 'match':
        return 'match';
      case 'project':
        return 'project';
      case 'sort':
        return 'sort';
      case 'limit':
        return 'limit';
      case 'skip':
        return 'skip';
      case 'lookup':
        return 'lookup';
      case 'unwind':
        return 'unwind';
      case 'group':
        return 'group';
      case 'addFields':
        return 'addFields';
      case 'replaceRoot':
        return 'replaceRoot';
      case 'count':
        return 'count';
      case 'sortByCount':
        return 'sortByCount';
      case 'sample':
        return 'sample';
      case 'redact':
        return 'redact';
      case 'out':
        return 'out';
      case 'unionWith':
        return 'unionWith';
      case 'bucket':
        return 'bucket';
      case 'bucketAuto':
        return 'bucketAuto';
      case 'geoNear':
        return 'geoNear';
      case 'facet':
        return 'facet';
      case 'graphLookup':
        return 'graphLookup';
      case 'merge':
        return 'merge';
      case 'setWindowFields':
        return 'setWindowFields';
      case 'densify':
        return 'densify';
      case 'fill':
        return 'fill';
      case 'search':
        return 'search';
      case 'searchMeta':
        return 'searchMeta';
      case 'vectorSearch':
        return 'vectorSearch';
      default: {
        const _exhaustive: never = stage;
        return _exhaustive;
      }
    }
  }
  assertType<(stage: MongoPipelineStage) => string>(exhaustiveSwitch);
});

test('accept returns R for any visitor R', () => {
  const stage = {} as unknown as MongoMatchStage;
  const visitor: MongoStageVisitor<number> = {
    match: () => 1,
    project: () => 2,
    sort: () => 3,
    limit: () => 4,
    skip: () => 5,
    lookup: () => 6,
    unwind: () => 7,
    group: () => 8,
    addFields: () => 9,
    replaceRoot: () => 10,
    count: () => 11,
    sortByCount: () => 12,
    sample: () => 13,
    redact: () => 14,
    out: () => 15,
    unionWith: () => 16,
    bucket: () => 17,
    bucketAuto: () => 18,
    geoNear: () => 19,
    facet: () => 20,
    graphLookup: () => 21,
    merge: () => 22,
    setWindowFields: () => 23,
    densify: () => 24,
    fill: () => 25,
    search: () => 26,
    searchMeta: () => 27,
    vectorSearch: () => 28,
  };
  expectTypeOf(stage.accept(visitor)).toBeNumber();
});

test('raw objects are not assignable to MongoPipelineStage', () => {
  // @ts-expect-error - raw objects are not valid pipeline stages
  assertType<MongoPipelineStage>({ $match: { status: 'active' } });
});
