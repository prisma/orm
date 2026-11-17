import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { describe, expectTypeOf, it } from 'vitest';
import type { PipelineChain } from '../src/builder';
import type { FindAndModifyEnabled, UpdateEnabled } from '../src/markers';
import { mongoQuery } from '../src/query';
import type { CollectionHandle, FilteredCollection } from '../src/state-classes';
import { contextOf } from './fixtures/test-context';
import type { TContract } from './fixtures/test-contract';

declare const contract: TContract;

/**
 * Extract the `UpdateEnabled` marker from any `PipelineChain` (or subclass).
 * Used by the marker-table assertions below to interrogate transition results
 * without having to reconstruct the full `Shape` parameter at the call site.
 */
type GetU<T> =
  T extends PipelineChain<infer _TContract, infer _Shape, infer U, infer _F, infer _L, infer _N>
    ? U
    : never;

type GetF<T> =
  T extends PipelineChain<infer _TContract, infer _Shape, infer _U, infer F, infer _L, infer _N>
    ? F
    : never;

describe('state machine', () => {
  it('from(name) returns CollectionHandle (root state) inheriting PipelineChain', () => {
    const handle = mongoQuery({ context: contextOf(contract) }).from('orders');
    expectTypeOf(handle).toExtend<CollectionHandle<TContract, 'Order'>>();
  });

  it('CollectionHandle.match(...) transitions to FilteredCollection', () => {
    const filtered = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .match(MongoFieldFilter.eq('status', 'active'));
    expectTypeOf(filtered).toExtend<FilteredCollection<TContract, 'Order'>>();
  });

  it('FilteredCollection.match(...) stays in FilteredCollection (AND-folds)', () => {
    const filtered = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .match(MongoFieldFilter.eq('status', 'active'))
      .match(MongoFieldFilter.gt('amount', 100));
    expectTypeOf(filtered).toExtend<FilteredCollection<TContract, 'Order'>>();
  });

  it('pipeline-stage methods drop out of the state-class subclasses', () => {
    const sorted = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .sort({ amount: -1 });
    // No longer a CollectionHandle/FilteredCollection — write/find-and-modify
    // surfaces have been left behind.
    expectTypeOf(sorted).not.toExtend<CollectionHandle<TContract, 'Order'>>();
    expectTypeOf(sorted).not.toExtend<FilteredCollection<TContract, 'Order'>>();
  });

  it('from(name) starts with both markers cleared', () => {
    // `.from(...)` returns a `CollectionHandle` that extends
    // `PipelineChain<..., 'update-cleared', 'fam-cleared'>` — the update and
    // find-and-modify terminals inherited from `PipelineChain` are gated off
    // by default, so a leading `.match(...)` is required before reaching them
    // via the `FilteredCollection` overrides (see ADR 201).
    const handle = mongoQuery({ context: contextOf(contract) }).from('orders');
    expectTypeOf<GetU<typeof handle>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof handle>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();
  });

  it('match(...) transitions to FilteredCollection, markers remain cleared', () => {
    // `FilteredCollection` extends `PipelineChain<..., 'update-cleared',
    // 'fam-cleared'>` for the same reason — the write/find-and-modify
    // terminals on `FilteredCollection` are dedicated overrides (not the
    // marker-gated PipelineChain versions), so the initial marker state
    // stays cleared to prevent accidental access to the PipelineChain
    // inheritance path.
    const filtered = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .match(MongoFieldFilter.eq('status', 'active'));
    expectTypeOf<GetU<typeof filtered>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof filtered>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();
  });

  it('marker table: limit() leaves both markers cleared', () => {
    const limited = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .limit(1);
    expectTypeOf<GetU<typeof limited>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof limited>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();
  });

  it('marker table: sort / addFields / group all leave both markers cleared from .from()', () => {
    const sorted = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .sort({ amount: -1 });
    expectTypeOf<GetU<typeof sorted>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof sorted>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();

    const added = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .addFields((f) => ({ doubled: f.amount }));
    expectTypeOf<GetU<typeof added>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof added>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();

    const grouped = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .group((_f) => ({ _id: null }));
    expectTypeOf<GetU<typeof grouped>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof grouped>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();
  });

  // AC-4 / TC-5: lookup() clears both markers (consistent with the legacy
  // shape; see ADR 201 marker table). Asserted directly on the marker
  // parameters here; the runtime / shape behaviour is asserted in
  // builder.test-d.ts.
  it('marker table: lookup() clears both markers', () => {
    const looked = mongoQuery({ context: contextOf(contract) })
      .from('orders')
      .lookup((from) =>
        from('users')
          .on((local, foreign) => ({
            local: local.customerId,
            foreign: foreign._id,
          }))
          .as('customer'),
      );
    expectTypeOf<GetU<typeof looked>>().toEqualTypeOf<'update-cleared' & UpdateEnabled>();
    expectTypeOf<GetF<typeof looked>>().toEqualTypeOf<'fam-cleared' & FindAndModifyEnabled>();
  });
});
