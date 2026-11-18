import {
  MongoAggAccumulator,
  MongoAggFieldRef,
  MongoBucketAutoStage,
  MongoBucketStage,
  MongoCountStage,
  MongoDensifyStage,
  MongoFacetStage,
  MongoFieldFilter,
  MongoFillStage,
  MongoGeoNearStage,
  MongoGraphLookupStage,
  MongoLimitStage,
  MongoMatchStage,
  MongoMergeStage,
  MongoOutStage,
  MongoRedactStage,
  MongoSearchMetaStage,
  MongoSearchStage,
  MongoSetWindowFieldsStage,
  MongoSortStage,
  MongoUnionWithStage,
  MongoVectorSearchStage,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import { testContract } from './fixtures/test-contract';

function createOrdersBuilder() {
  return mongoQuery({ context: contextOf(testContract) }).from('orders');
}

describe('new stage builder methods', () => {
  describe('redact()', () => {
    it('adds MongoRedactStage', () => {
      const plan = createOrdersBuilder()
        .redact((f) => f.status)
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoRedactStage);
    });
  });

  describe('out()', () => {
    it('terminates the chain into a write plan with $out as the final stage', () => {
      const plan = createOrdersBuilder().out('results');
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoOutStage);
      expect((pipeline[0] as MongoOutStage).collection).toBe('results');
      expect(plan.meta.lane).toBe('mongo-query');
    });

    it('threads the optional db parameter through to the stage', () => {
      const plan = createOrdersBuilder().out('results', 'archive');
      const stage = plan.command.pipeline[0] as MongoOutStage;
      expect(stage.db).toBe('archive');
    });
  });

  describe('merge()', () => {
    it('terminates the chain into a write plan with $merge as the final stage', () => {
      const plan = createOrdersBuilder().merge({ into: 'output', whenMatched: 'replace' });
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoMergeStage);
      expect((pipeline[0] as MongoMergeStage).into).toBe('output');
      expect(plan.meta.lane).toBe('mongo-query');
    });
  });

  describe('unionWith()', () => {
    it('adds MongoUnionWithStage', () => {
      const plan = createOrdersBuilder().unionWith('archived_orders').build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoUnionWithStage);
      expect((pipeline[0] as MongoUnionWithStage).collection).toBe('archived_orders');
    });

    it('accepts optional pipeline', () => {
      const plan = createOrdersBuilder()
        .unionWith('archived_orders', [new MongoMatchStage(MongoFieldFilter.eq('active', true))])
        .build();
      const stage = plan.command.pipeline[0] as MongoUnionWithStage;
      expect(stage.pipeline).toHaveLength(1);
    });
  });

  describe('bucket()', () => {
    it('adds MongoBucketStage', () => {
      const plan = createOrdersBuilder()
        .bucket({
          groupBy: MongoAggFieldRef.of('amount'),
          boundaries: [0, 100, 500],
        })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoBucketStage);
    });
  });

  describe('bucketAuto()', () => {
    it('adds MongoBucketAutoStage', () => {
      const plan = createOrdersBuilder()
        .bucketAuto({
          groupBy: MongoAggFieldRef.of('amount'),
          buckets: 5,
        })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoBucketAutoStage);
    });
  });

  describe('geoNear()', () => {
    it('adds MongoGeoNearStage', () => {
      const plan = createOrdersBuilder()
        .geoNear({
          near: { type: 'Point', coordinates: [0, 0] },
          distanceField: 'dist',
        })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoGeoNearStage);
    });
  });

  describe('facet()', () => {
    it('adds MongoFacetStage', () => {
      const plan = createOrdersBuilder()
        .facet({
          counts: [new MongoCountStage('total')],
          topItems: [new MongoSortStage({ amount: -1 }), new MongoLimitStage(5)],
        })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoFacetStage);
      const facet = pipeline[0] as MongoFacetStage;
      expect(Object.keys(facet.facets)).toEqual(['counts', 'topItems']);
    });
  });

  describe('graphLookup()', () => {
    it('adds MongoGraphLookupStage', () => {
      const plan = createOrdersBuilder()
        .graphLookup({
          from: 'categories',
          startWith: MongoAggFieldRef.of('categoryId'),
          connectFromField: 'parentId',
          connectToField: '_id',
          as: 'ancestors',
        })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoGraphLookupStage);
    });
  });

  describe('setWindowFields()', () => {
    it('adds MongoSetWindowFieldsStage', () => {
      const plan = createOrdersBuilder()
        .setWindowFields({
          sortBy: { amount: 1 },
          output: {
            runningTotal: {
              operator: MongoAggAccumulator.sum(MongoAggFieldRef.of('amount')),
              window: { documents: [Number.NEGATIVE_INFINITY, 0] as [number, number] },
            },
          },
        })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSetWindowFieldsStage);
    });
  });

  describe('densify()', () => {
    it('adds MongoDensifyStage', () => {
      const plan = createOrdersBuilder()
        .densify({ field: 'date', range: { step: 1, unit: 'day', bounds: 'full' } })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoDensifyStage);
    });
  });

  describe('fill()', () => {
    it('adds MongoFillStage', () => {
      const plan = createOrdersBuilder()
        .fill({ sortBy: { date: 1 }, output: { amount: { method: 'linear' } } })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoFillStage);
    });
  });

  describe('search()', () => {
    it('adds MongoSearchStage', () => {
      const plan = createOrdersBuilder()
        .search({ text: { query: 'widget', path: 'description' } })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSearchStage);
    });
  });

  describe('searchMeta()', () => {
    it('adds MongoSearchMetaStage', () => {
      const plan = createOrdersBuilder()
        .searchMeta({ facet: { operator: {} } })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSearchMetaStage);
    });
  });

  describe('vectorSearch()', () => {
    it('adds MongoVectorSearchStage', () => {
      const plan = createOrdersBuilder()
        .vectorSearch({
          index: 'vec_idx',
          path: 'embedding',
          queryVector: [0.1, 0.2],
          numCandidates: 100,
          limit: 10,
        })
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoVectorSearchStage);
    });
  });
});
