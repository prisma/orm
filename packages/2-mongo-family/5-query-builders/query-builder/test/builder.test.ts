import {
  AggregateCommand,
  MongoAddFieldsStage,
  MongoAggAccumulator,
  MongoAggFieldRef,
  MongoAggOperator,
  MongoCountStage,
  MongoExistsExpr,
  MongoFieldFilter,
  MongoGroupStage,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoProjectStage,
  MongoReplaceRootStage,
  MongoSampleStage,
  MongoSkipStage,
  MongoSortByCountStage,
  MongoSortStage,
  MongoUnwindStage,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import { fn } from '../src/expression-helpers';
import type { LookupOnResult } from '../src/lookup-builder';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import { testContract } from './fixtures/test-contract';

function createOrdersBuilder() {
  return mongoQuery({ context: contextOf(testContract) }).from('orders');
}

function createCustomersBuilder() {
  return mongoQuery({ context: contextOf(testContract) }).from('customers');
}

describe('PipelineChain', () => {
  describe('build()', () => {
    it('produces AggregateCommand with correct collection', () => {
      const plan = createOrdersBuilder().build();
      expect(plan.collection).toBe('orders');
      expect(plan.command).toBeInstanceOf(AggregateCommand);
      expect(plan.command.collection).toBe('orders');
    });

    it('produces PlanMeta with lane: mongo-query', () => {
      const plan = createOrdersBuilder().build();
      expect(plan.meta.lane).toBe('mongo-query');
      expect(plan.meta.target).toBe('mongo');
      expect(plan.meta.storageHash).toBe('test-hash');
    });
  });

  describe('identity stages', () => {
    it('match(filter) appends MongoMatchStage', () => {
      const filter = MongoFieldFilter.eq('status', 'active');
      const plan = createOrdersBuilder().match(filter).build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoMatchStage);
    });

    it('match(callback) appends MongoMatchStage', () => {
      const plan = createOrdersBuilder()
        .match((f) => f.status.eq('active'))
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoMatchStage);
    });

    // Runtime non-regression spot-check for TML-2281: the callable dot-path
    // form must emit the exact same `MongoFieldFilter.eq('address.city', …)`
    // node as the property form, even after `FieldAccessor` was split into
    // conditional leaf vs. object-expression variants.
    it('match callable dot-path emits identical MongoFieldFilter as property form', () => {
      const callablePlan = createCustomersBuilder()
        .match((f) => f('address.city').eq('NYC'))
        .build();
      const callableStage = callablePlan.command.pipeline[0] as MongoMatchStage;

      const expectedFilter = MongoFieldFilter.eq('address.city', 'NYC');
      expect(callableStage).toBeInstanceOf(MongoMatchStage);
      expect(callableStage.filter).toEqual(expectedFilter);
    });

    // Runtime non-regression for the `f.rawPath(path)` escape hatch
    // (TML-2281): the resulting expression must emit the same filter/update
    // nodes as the strict callable form, just without compile-time path
    // validation.
    it('match via f.rawPath(path) emits identical nodes as the strict callable', () => {
      const rawPlan = createCustomersBuilder()
        .match((f) => f.rawPath('status').exists(false))
        .build();
      const rawStage = rawPlan.command.pipeline[0] as MongoMatchStage;

      const expectedFilter = MongoExistsExpr.notExists('status');
      expect(rawStage).toBeInstanceOf(MongoMatchStage);
      expect(rawStage.filter).toEqual(expectedFilter);
    });

    it('sort() appends MongoSortStage', () => {
      const plan = createOrdersBuilder().sort({ amount: -1 }).build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSortStage);
      expect((pipeline[0] as MongoSortStage).sort).toEqual({ amount: -1 });
    });

    it('limit() appends MongoLimitStage', () => {
      const plan = createOrdersBuilder().limit(10).build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoLimitStage);
      expect((pipeline[0] as MongoLimitStage).limit).toBe(10);
    });

    it('skip() appends MongoSkipStage', () => {
      const plan = createOrdersBuilder().skip(5).build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSkipStage);
      expect((pipeline[0] as MongoSkipStage).skip).toBe(5);
    });

    it('sample() appends MongoSampleStage', () => {
      const plan = createOrdersBuilder().sample(3).build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSampleStage);
      expect((pipeline[0] as MongoSampleStage).size).toBe(3);
    });
  });

  describe('addFields()', () => {
    it('produces MongoAddFieldsStage with correct expressions', () => {
      const plan = createOrdersBuilder()
        .addFields((f) => ({
          fullName: fn.concat(f.status, fn.literal(' ')),
        }))
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoAddFieldsStage);
      const stage = pipeline[0] as MongoAddFieldsStage;
      expect(stage.fields).toHaveProperty('fullName');
      expect(stage.fields['fullName']).toBeInstanceOf(MongoAggOperator);
    });
  });

  describe('project()', () => {
    it('inclusion form produces MongoProjectStage', () => {
      const plan = createOrdersBuilder().project('status', 'amount').build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoProjectStage);
      const stage = pipeline[0] as MongoProjectStage;
      expect(stage.projection).toEqual({ status: 1, amount: 1 });
    });

    it('computed form produces MongoProjectStage with expressions', () => {
      const plan = createOrdersBuilder()
        .project((f) => ({
          status: 1 as const,
          upper: fn.toUpper(f.status),
        }))
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      const stage = pipeline[0] as MongoProjectStage;
      expect(stage.projection['status']).toBe(1);
      expect(stage.projection['upper']).toBeInstanceOf(MongoAggOperator);
    });
  });

  describe('group()', () => {
    it('produces MongoGroupStage with accumulators', () => {
      const plan = createOrdersBuilder()
        .group((f) => ({
          _id: f.customerId,
          total: acc.sum(f.amount),
          orderCount: acc.count(),
        }))
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoGroupStage);
      const stage = pipeline[0] as MongoGroupStage;
      expect(stage.groupId).toBeInstanceOf(MongoAggFieldRef);
      expect(stage.accumulators).toHaveProperty('total');
      expect(stage.accumulators).toHaveProperty('orderCount');
      expect(stage.accumulators['total']).toBeInstanceOf(MongoAggAccumulator);
      expect(stage.accumulators['orderCount']).toBeInstanceOf(MongoAggAccumulator);
    });

    it('rejects null for non-_id keys', () => {
      expect(() =>
        createOrdersBuilder().group((f) => ({
          _id: f.customerId,
          total: null as ReturnType<typeof acc.sum> | null,
        })),
      ).toThrow('must not be null');
    });

    it('rejects non-accumulator expressions for non-_id keys', () => {
      expect(() =>
        createOrdersBuilder().group((f) => ({
          _id: f.customerId,
          total: f.amount as ReturnType<typeof acc.sum>,
        })),
      ).toThrow('must use an accumulator');
    });

    it('handles _id: null for whole-collection grouping', () => {
      const plan = createOrdersBuilder()
        .group((f) => ({
          _id: null,
          total: acc.sum(f.amount),
        }))
        .build();
      const stage = plan.command.pipeline[0] as MongoGroupStage;
      expect(stage.groupId).toBeNull();
    });
  });

  describe('unwind()', () => {
    it('produces MongoUnwindStage', () => {
      const plan = createOrdersBuilder().unwind('status').build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoUnwindStage);
      expect((pipeline[0] as MongoUnwindStage).path).toBe('$status');
    });

    it('passes preserveNullAndEmptyArrays option', () => {
      const plan = createOrdersBuilder()
        .unwind('status', { preserveNullAndEmptyArrays: true })
        .build();
      const stage = plan.command.pipeline[0] as MongoUnwindStage;
      expect(stage.preserveNullAndEmptyArrays).toBe(true);
    });
  });

  describe('count()', () => {
    it('produces MongoCountStage', () => {
      const plan = createOrdersBuilder().count('total').build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoCountStage);
      expect((pipeline[0] as MongoCountStage).field).toBe('total');
    });
  });

  describe('sortByCount()', () => {
    it('produces MongoSortByCountStage', () => {
      const plan = createOrdersBuilder()
        .sortByCount((f) => f.status)
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoSortByCountStage);
    });
  });

  describe('lookup()', () => {
    it('appends a MongoLookupStage with the resolved foreign collection / fields / as', () => {
      const plan = createOrdersBuilder()
        .lookup((from) =>
          from('users')
            .on((local, foreign) => ({
              local: local.customerId,
              foreign: foreign._id,
            }))
            .as('customer'),
        )
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoLookupStage);
      const stage = pipeline[0] as MongoLookupStage;
      expect(stage.from).toBe('users');
      expect(stage.localField).toBe('customerId');
      expect(stage.foreignField).toBe('_id');
      expect(stage.as).toBe('customer');
    });

    // AC-5 / TC-6: structural equivalence — the new chained-callback shape
    // emits the same MongoLookupStage as a hand-rolled construction with
    // equivalent inputs. Pinning this prevents drift in the wire-level
    // command shape (NFR6).
    it('emits a MongoLookupStage structurally equal to direct construction (AC-5 TC-6)', () => {
      const plan = createOrdersBuilder()
        .lookup((from) =>
          from('users')
            .on((local, foreign) => ({
              local: local.customerId,
              foreign: foreign._id,
            }))
            .as('customer'),
        )
        .build();
      const builderStage = plan.command.pipeline[0] as MongoLookupStage;
      const referenceStage = new MongoLookupStage({
        from: 'users',
        localField: 'customerId',
        foreignField: '_id',
        as: 'customer',
      });
      expect(builderStage).toEqual(referenceStage);
    });

    it('throws for unknown root at runtime', () => {
      expect(() =>
        createOrdersBuilder().lookup((from) =>
          // The cast is needed because Contract.roots: Record<string, string>
          // does not preserve literal keys under intersection (see
          // TML-2400); the runtime guard catches the bad root regardless.
          from('nonexistent' as 'users')
            .on((local, foreign) => ({
              local: local.customerId,
              foreign: foreign._id,
            }))
            .as('items'),
        ),
      ).toThrow('lookup() unknown root: "nonexistent"');
    });

    // AC-2 runtime backstop: compile-time gating via LookupOnResult's
    // LeafExpression already rejects non-leaf returns at the type level
    // (covered in builder.test-d.ts), but a defensive runtime guard
    // catches callers that bypass typing by casting.
    it('throws when on() returns a non-leaf expression at runtime', () => {
      expect(() =>
        createOrdersBuilder().lookup((from) =>
          from('users')
            .on(
              (_local, foreign) =>
                // Bypass the type system — a real call site cannot do
                // this without the cast (covered by AC-2 type test).
                ({
                  local: { _path: '' } as unknown as LookupOnResult['local'],
                  foreign: foreign._id,
                }) satisfies LookupOnResult,
            )
            .as('customer'),
        ),
      ).toThrow(/leaf field reference/i);
    });
  });

  describe('replaceRoot()', () => {
    it('produces MongoReplaceRootStage', () => {
      const plan = createOrdersBuilder()
        .replaceRoot((f) => f.status)
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoReplaceRootStage);
    });
  });

  describe('pipe()', () => {
    it('appends raw stage preserving shape', () => {
      const rawStage = new MongoLimitStage(5);
      const plan = createOrdersBuilder().pipe(rawStage).build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(1);
      expect(pipeline[0]).toBeInstanceOf(MongoLimitStage);
    });
  });

  describe('chaining', () => {
    it('chains multiple stages correctly', () => {
      const plan = createOrdersBuilder()
        .match((f) => f.status.eq('active'))
        .sort({ amount: -1 })
        .limit(10)
        .build();
      const pipeline = plan.command.pipeline;
      expect(pipeline).toHaveLength(3);
      expect(pipeline[0]).toBeInstanceOf(MongoMatchStage);
      expect(pipeline[1]).toBeInstanceOf(MongoSortStage);
      expect(pipeline[2]).toBeInstanceOf(MongoLimitStage);
    });
  });
});

describe('mongoQuery()', () => {
  it('from() creates builder for known root', () => {
    const p = mongoQuery({ context: contextOf(testContract) });
    const builder = p.from('orders');
    const plan = builder.build();
    expect(plan.collection).toBe('orders');
  });

  it('from() throws for unknown root', () => {
    const p = mongoQuery({ context: contextOf(testContract) });
    expect(() => p.from('nonexistent' as 'orders')).toThrow('Unknown root');
  });
});
