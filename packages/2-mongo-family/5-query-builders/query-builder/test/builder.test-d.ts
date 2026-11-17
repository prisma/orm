import type {
  MongoExecutionContext,
  MongoFilterExpr,
  MongoQueryPlan,
} from '@internal/mongo-query-ast/execution';
import { MongoAggFieldRef, MongoLimitStage } from '@internal/mongo-query-ast/execution';
import { expectTypeOf } from 'vitest';
import { acc } from '../src/accumulator-helpers';
import { fn } from '../src/expression-helpers';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import type { TContract } from './fixtures/test-contract';

declare const contract: TContract;
declare const context: MongoExecutionContext<TContract>;

type PlanRow<P extends MongoQueryPlan> = P extends MongoQueryPlan<infer R> ? R : never;

type OrderRow = {
  readonly _id: string;
  readonly status: string;
  readonly amount: number;
  readonly customerId: string;
  readonly notes: string | null;
  readonly tags: string[];
};

describe('mongoQuery', () => {
  it('takes an execution context, not a contract', () => {
    expectTypeOf(mongoQuery({ context }).from('orders')).not.toBeNever();
    // @ts-expect-error -- a contract alone is not accepted; build the context with mongoStatic() or mongo()
    mongoQuery({ contract });
    // @ts-expect-error -- an object holding only a contract is not an execution context
    mongoQuery({ context: { contract } });
  });
});

describe('builder shape tests', () => {
  it('sort() only accepts keys from current shape', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    const builder = p.from('orders');
    builder.sort({ amount: -1 });
    builder.sort({ status: 1 });
    // @ts-expect-error -- 'bogus' is not in shape
    builder.sort({ bogus: 1 });
  });

  it('group() replaces shape — previous fields inaccessible', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    const grouped = p.from('orders').group((f) => ({
      _id: f.customerId,
      total: acc.sum(f.amount),
      orderCount: acc.count(),
    }));

    grouped.sort({ total: -1 });
    grouped.sort({ orderCount: 1 });

    // @ts-expect-error -- 'status' no longer exists after group
    grouped.sort({ status: 1 });
    // @ts-expect-error -- 'amount' no longer exists after group
    grouped.sort({ amount: 1 });
  });

  it('addFields() extends shape', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    const extended = p.from('orders').addFields((f) => ({
      fullName: fn.concat(f.status, fn.literal(' ')),
    }));

    extended.sort({ status: 1 });
    extended.sort({ fullName: 1 });
  });

  it('project() inclusion narrows shape', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    const projected = p.from('orders').project('status', 'amount');

    projected.sort({ status: 1 });
    projected.sort({ amount: 1 });

    // @ts-expect-error -- 'customerId' was projected out
    projected.sort({ customerId: 1 });
  });

  it('count() replaces shape with single field', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    const counted = p.from('orders').count('total');

    counted.sort({ total: 1 });
    // @ts-expect-error -- only 'total' exists
    counted.sort({ status: 1 });
  });

  it('lookup() adds array field and preserves existing fields', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    const withLookup = p.from('orders').lookup((from) =>
      from('users')
        .on((local, foreign) => ({
          local: local.customerId,
          foreign: foreign._id,
        }))
        .as('customer'),
    );

    withLookup.sort({ status: 1 });
    withLookup.sort({ amount: -1 });
    withLookup.sort({ customer: 1 });

    // @ts-expect-error -- 'bogus' is not in shape
    withLookup.sort({ bogus: 1 });
  });

  it('lookup() rejects bad local field at type level (AC-1 TC-1)', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    p.from('orders').lookup((from) =>
      from('users')
        .on((local, foreign) => ({
          // @ts-expect-error -- '_idxx' is not a field on the Order shape
          local: local._idxx,
          foreign: foreign._id,
        }))
        .as('customer'),
    );
  });

  it('lookup() rejects bad foreign field at type level (AC-1 TC-2)', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    p.from('orders').lookup((from) =>
      from('users')
        .on((local, foreign) => ({
          local: local.customerId,
          // @ts-expect-error -- '_idxx' is not a field on the User shape
          foreign: foreign._idxx,
        }))
        .as('customer'),
    );
  });

  it('lookup() rejects non-leaf returns from on() (AC-2 TC-3)', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    p.from('orders').lookup((from) =>
      from('users')
        .on((local, foreign) => ({
          // @ts-expect-error -- fn.toUpper(...) returns TypedAggExpr<StringField>, not LeafExpression
          local: fn.toUpper(local.customerId),
          foreign: foreign._id,
        }))
        .as('customer'),
    );
  });

  // Bad-from(name) typo rejection is intentionally not tested here — it is
  // deferred to TML-2400 (Contract.roots: Record<string, string> widens
  // keyof under intersection, identical to today's mongoQuery.from('bad')
  // behaviour). See spec § Open Questions / Resolved decisions.

  it('replaceRoot() replaces entire shape', () => {
    const p = mongoQuery({ context: contextOf(contract) });
    type NewShape = {
      readonly x: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    };
    const replaced = p.from('orders').replaceRoot<NewShape>((f) => f.status);

    replaced.sort({ x: 1 });

    // @ts-expect-error -- 'status' no longer exists after replaceRoot
    replaced.sort({ status: 1 });
  });
});

describe('resolved row types', () => {
  it('from() → build() resolves to concrete field types', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('match() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .match((f) => f.status.eq('active') as MongoFilterExpr)
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('sort() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .sort({ amount: -1 })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('limit() / skip() / sample() preserve row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .limit(10)
      .skip(5)
      .sample(3)
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('addFields() extends row with new fields at correct types', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .addFields((f) => ({
        fullName: fn.concat(f.status, fn.literal(' ')),
        doubled: fn.multiply(f.amount, fn.literal(2)),
      }))
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      readonly _id: string;
      readonly status: string;
      readonly amount: number;
      readonly customerId: string;
      readonly notes: string | null;
      readonly tags: string[];
      fullName: string;
      doubled: number;
    }>();
  });

  it('project() inclusion narrows to selected fields at correct types', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .project('status', 'amount')
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      _id: string;
      status: string;
      amount: number;
    }>();
  });

  it('project() computed includes expression fields at correct types', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .project((f) => ({
        status: 1 as const,
        upper: fn.toUpper(f.status),
        doubled: fn.multiply(f.amount, fn.literal(2)),
      }))
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      _id: string;
      status: string;
      upper: string;
      doubled: number;
    }>();
  });

  it('group() resolves _id at grouped-by field type, accumulators at correct types', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .group((f) => ({
        _id: f.customerId,
        total: acc.sum(f.amount),
        orderCount: acc.count(),
        maxAmount: acc.max(f.amount),
      }))
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      _id: string;
      total: number;
      orderCount: number;
      maxAmount: number | null;
    }>();
  });

  it('unwind() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .unwind('tags')
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('count() row type is { [field]: number }', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .count('total')
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{ total: number }>();
  });

  it('sortByCount() row type is { _id: <field type>; count: number }', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .sortByCount((f) => f.status)
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      _id: string;
      count: number;
    }>();
  });

  it('lookup() resolves the as-named field to Array<ForeignRow> with concrete leaf types (AC-3 TC-4)', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .lookup((from) =>
        from('users')
          .on((local, foreign) => ({
            local: local.customerId,
            foreign: foreign._id,
          }))
          .as('customer'),
      )
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      readonly _id: string;
      readonly status: string;
      readonly amount: number;
      readonly customerId: string;
      readonly notes: string | null;
      readonly tags: string[];
      customer: Array<{
        readonly _id: string;
        readonly firstName: string;
        readonly lastName: string;
        readonly email: string;
      }>;
    }>();
  });

  it('lookup() resolves nested value-object fields on the foreign model recursively', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .lookup((from) =>
        from('customers')
          .on((local, foreign) => ({
            local: local.customerId,
            foreign: foreign._id,
          }))
          .as('customer'),
      )
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      readonly _id: string;
      readonly status: string;
      readonly amount: number;
      readonly customerId: string;
      readonly notes: string | null;
      readonly tags: string[];
      customer: Array<{
        readonly _id: string;
        readonly name: string;
        readonly address: {
          street: string;
          city: string;
          zip: string | null;
          geo: { lat: number; lng: number };
        };
        readonly workAddress: {
          street: string;
          city: string;
          zip: string | null;
          geo: { lat: number; lng: number };
        } | null;
        readonly stats: { visits: number; lastSeen: Date | null };
      }>;
    }>();
  });

  it('entry-point query resolves value-object fields recursively (model-origin brand)', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('customers')
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      readonly _id: string;
      readonly name: string;
      readonly address: {
        street: string;
        city: string;
        zip: string | null;
        geo: { lat: number; lng: number };
      };
      readonly workAddress: {
        street: string;
        city: string;
        zip: string | null;
        geo: { lat: number; lng: number };
      } | null;
      readonly stats: { visits: number; lastSeen: Date | null };
    }>();
  });

  it('addFields() preserves model-origin resolution and adds the new fields on top', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('customers')
      .addFields((f) => ({
        upperName: fn.concat(f.name, fn.literal('!')),
      }))
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      readonly _id: string;
      readonly name: string;
      readonly address: {
        street: string;
        city: string;
        zip: string | null;
        geo: { lat: number; lng: number };
      };
      readonly workAddress: {
        street: string;
        city: string;
        zip: string | null;
        geo: { lat: number; lng: number };
      } | null;
      readonly stats: { visits: number; lastSeen: Date | null };
      upperName: string;
    }>();
  });

  it('group() drops model-origin resolution (legitimate shape replacement)', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('customers')
      .group((f) => ({
        _id: f.name,
        count: acc.count(),
      }))
      .build();
    // After group, row type is the projected shape — no value-object resolution
    // because the row is no longer model-rooted.
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      _id: string;
      count: number;
    }>();
  });

  it('replaceRoot() resolves to the new shape with concrete types', () => {
    type NewShape = {
      readonly x: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
      readonly y: { readonly codecId: 'mongo/double@1'; readonly nullable: true };
    };
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .replaceRoot<NewShape>((f) => f.status)
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      x: string;
      y: number | null;
    }>();
  });

  it('pipe() preserves row type by default', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .pipe(new MongoLimitStage(5))
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('pipe<NewShape>() narrows to the specified shape', () => {
    type NewShape = {
      readonly a: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
    };
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .pipe<NewShape>(new MongoLimitStage(5))
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{ a: string }>();
  });

  it('nullable fields resolve to T | null', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .build();
    type Row = PlanRow<typeof plan>;
    expectTypeOf<Row['notes']>().toEqualTypeOf<string | null>();
    expectTypeOf<Row['status']>().toEqualTypeOf<string>();
  });

  it('chained pipeline produces correct cumulative row types', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .match((f) => f.status.eq('active') as MongoFilterExpr)
      .group((f) => ({
        _id: f.customerId,
        total: acc.sum(f.amount),
        orderCount: acc.count(),
      }))
      .sort({ total: -1 })
      .limit(10)
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<{
      _id: string;
      total: number;
      orderCount: number;
    }>();
  });

  it('execute() infers Row from build() plan type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .build();
    const execute = {} as <Row>(p: MongoQueryPlan<Row>) => Promise<Row[]>;
    const result = execute(plan);
    expectTypeOf<Awaited<typeof result>[0]>().toEqualTypeOf<OrderRow>();
  });
});

describe('resolved row types — new stages', () => {
  it('redact() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .redact((f) => f.status)
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('out() returns a write-terminal plan with an unknown row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .out('archive');
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<unknown>();
  });

  it('merge() returns a write-terminal plan with an unknown row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .merge({ into: 'summary' });
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<unknown>();
  });

  it('unionWith() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .unionWith('archived_orders')
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('densify() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .densify({ field: 'amount', range: { step: 10, bounds: 'full' } })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('fill() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .fill({ sortBy: { amount: 1 }, output: { notes: { method: 'linear' } } })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('search() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .search({ text: { query: 'test', path: 'status' } })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('vectorSearch() preserves row type', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .vectorSearch({
        index: 'idx',
        path: 'embedding',
        queryVector: [0.1],
        numCandidates: 50,
        limit: 10,
      })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<OrderRow>();
  });

  it('bucket() resets to untyped row', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .bucket({ groupBy: MongoAggFieldRef.of('amount'), boundaries: [0, 100, 500] })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<Record<string, unknown>>();
  });

  it('bucketAuto() resets to untyped row', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .bucketAuto({ groupBy: MongoAggFieldRef.of('amount'), buckets: 5 })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<Record<string, unknown>>();
  });

  it('facet() resets to untyped row', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .facet({ counts: [], top: [] })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<Record<string, unknown>>();
  });

  it('geoNear() resets to untyped row', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .geoNear({ near: [0, 0], distanceField: 'dist' })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<Record<string, unknown>>();
  });

  it('graphLookup() resets to untyped row', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .graphLookup({
        from: 'categories',
        startWith: MongoAggFieldRef.of('categoryId'),
        connectFromField: 'parentId',
        connectToField: '_id',
        as: 'ancestors',
      })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<Record<string, unknown>>();
  });

  it('setWindowFields() resets to untyped row', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .setWindowFields({ sortBy: { amount: 1 }, output: {} })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<Record<string, unknown>>();
  });

  it('searchMeta() resets to untyped row', () => {
    const plan = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .searchMeta({ facet: { operator: {} } })
      .build();
    expectTypeOf<PlanRow<typeof plan>>().toEqualTypeOf<Record<string, unknown>>();
  });
});
