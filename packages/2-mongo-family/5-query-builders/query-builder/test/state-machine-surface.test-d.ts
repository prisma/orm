import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { describe, it } from 'vitest';
import { mongoQuery } from '../src/query';
import { contextOf } from './fixtures/test-context';
import type { TContract } from './fixtures/test-contract';

declare const contract: TContract;
const handle = () => mongoQuery({ context: contextOf(contract) }).from('orders');
const filtered = () => handle().match(MongoFieldFilter.eq('status', 'new'));

/**
 * Negative-surface type tests for the M1 state machine + M2 write methods.
 *
 * The point is to lock down which methods *don't* exist on each state, so a
 * misuse like `mongoQuery(...).from('x').updateMany(...)` (writing to every
 * doc through the wrong terminal) doesn't typecheck. Each `@ts-expect-error`
 * here is load-bearing — its absence would silently re-open a footgun the
 * spec set out to close.
 */
describe('state-machine surface (negative type tests)', () => {
  it('CollectionHandle does not expose filtered-only terminals', () => {
    const h = handle();
    // @ts-expect-error — `deleteMany` requires a `.match(...)` first
    h.deleteMany();
    // @ts-expect-error — `deleteOne` requires a `.match(...)` first
    h.deleteOne();
  });

  it('CollectionHandle starts with cleared markers — bare update / find-and-modify terminals rejected', () => {
    // A25: `CollectionHandle` extends `PipelineChain<..., 'update-cleared',
    // 'fam-cleared'>`, so the marker-gated terminals inherited from
    // `PipelineChain` are compile-time unreachable without a leading
    // `.match(...)`. This matches `deconstructUpdateChain` /
    // `deconstructFindAndModifyChain`, which throw at runtime without a
    // leading `$match`.
    const h = handle();
    // @ts-expect-error — bare .updateMany() requires a leading .match(...)
    h.updateMany();
    // @ts-expect-error — bare .updateOne() requires a leading .match(...)
    h.updateOne();
    // @ts-expect-error — bare .findOneAndUpdate(...) requires a leading .match(...)
    h.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — bare .findOneAndDelete() requires a leading .match(...)
    h.findOneAndDelete();
  });

  it('FilteredCollection starts with fam-cleared — sort past the override stays rejected', () => {
    // A25: `FilteredCollection` also starts `'fam-cleared'`. The
    // findOneAndUpdate/findOneAndDelete methods on `FilteredCollection`
    // itself are dedicated overrides (reachable without markers), but
    // stages that return a `PipelineChain` (like `.sort(...)`) preserve
    // the cleared `F` marker, so the inherited find-and-modify terminals
    // remain unreachable there. Runtime tests that want to exercise the
    // `deconstructFindAndModifyChain` code path have to `as unknown as`
    // to force the call (see `test/find-and-modify.test.ts`).
    const sorted = filtered().sort({ amount: -1 });
    // @ts-expect-error — sort-past-FilteredCollection keeps F = 'fam-cleared'
    sorted.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — sort-past-FilteredCollection keeps F = 'fam-cleared'
    sorted.findOneAndDelete();
  });

  it('findOneAndUpdate / findOneAndDelete unavailable after FindAndModifyEnabled-clearing stages', () => {
    // .group() clears both markers
    const grouped = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .group(() => ({ _id: null }));
    // @ts-expect-error — group clears FindAndModifyEnabled
    grouped.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — group clears FindAndModifyEnabled
    grouped.findOneAndDelete();

    // .limit() clears both markers
    const limited = handle().match(MongoFieldFilter.eq('status', 'new')).limit(1);
    // @ts-expect-error — limit clears FindAndModifyEnabled
    limited.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — limit clears FindAndModifyEnabled
    limited.findOneAndDelete();

    // .addFields() clears FindAndModifyEnabled
    const withAddFields = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .addFields(() => ({}));
    // @ts-expect-error — addFields clears FindAndModifyEnabled
    withAddFields.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — addFields clears FindAndModifyEnabled
    withAddFields.findOneAndDelete();

    // .project() clears FindAndModifyEnabled
    const projected = handle().match(MongoFieldFilter.eq('status', 'new')).project('status');
    // @ts-expect-error — project clears FindAndModifyEnabled
    projected.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — project clears FindAndModifyEnabled
    projected.findOneAndDelete();

    // .unwind() clears both markers
    const unwound = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .unwind('tags' as never);
    // @ts-expect-error — unwind clears FindAndModifyEnabled
    unwound.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — unwind clears FindAndModifyEnabled
    unwound.findOneAndDelete();

    // .skip() clears FindAndModifyEnabled — MongoDB's findAndModify wire
    // command has no skip slot, so `deconstructFindAndModifyChain` rejects
    // any `$skip` at runtime. The type system mirrors that here.
    const skipped = handle().match(MongoFieldFilter.eq('status', 'new')).skip(1);
    // @ts-expect-error — skip clears FindAndModifyEnabled
    skipped.findOneAndUpdate((f) => [f.amount.inc(1)]);
    // @ts-expect-error — skip clears FindAndModifyEnabled
    skipped.findOneAndDelete();
  });

  it('updateMany / updateOne unavailable after UpdateEnabled-clearing stages', () => {
    // Each `@ts-expect-error` below pairs a shape-compatible updater
    // (`(f) => [f.amount.inc(1)]` against the surviving `orders` shape, or
    // `[f._id.set(null)]` after `group`) with the forbidden write terminal,
    // so the type error must come from the state gate (method absent from
    // this state) rather than from a missing callback argument. Without a
    // real updater, a regression that accidentally re-surfaces
    // `updateMany` onto the wrong state would still satisfy the
    // `@ts-expect-error` via "expected N arguments, got 0" and slip past
    // review.

    // .group() clears both markers — the shape collapses to `{ _id: null }`
    // so we use a `_id`-targeted updater that would typecheck against the
    // grouped shape if the method were wrongly re-surfaced.
    const grouped = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .group(() => ({ _id: null }));
    // @ts-expect-error — group clears UpdateEnabled
    grouped.updateMany((f) => [f._id.set(null)]);
    // @ts-expect-error — group clears UpdateEnabled
    grouped.updateOne((f) => [f._id.set(null)]);

    // .limit() clears both markers — shape preserved, so a standard
    // `amount.inc(1)` updater typechecks against the orders shape.
    const limited = handle().match(MongoFieldFilter.eq('status', 'new')).limit(1);
    // @ts-expect-error — limit clears UpdateEnabled
    limited.updateMany((f) => [f.amount.inc(1)]);
    // @ts-expect-error — limit clears UpdateEnabled
    limited.updateOne((f) => [f.amount.inc(1)]);

    // .sort() clears UpdateEnabled (preserves FindAndModifyEnabled) — shape
    // preserved, so we pair with a valid orders-shape updater.
    const sorted = handle().match(MongoFieldFilter.eq('status', 'new')).sort({ amount: -1 });
    // @ts-expect-error — sort clears UpdateEnabled
    sorted.updateMany((f) => [f.amount.inc(1)]);
    // @ts-expect-error — sort clears UpdateEnabled
    sorted.updateOne((f) => [f.amount.inc(1)]);

    // .match(...).addFields(...).match(...) — the second .match() sits past
    // the leading-match prefix. `deconstructUpdateChain` only peels *leading*
    // `$match` stages into the wire-command filter, so the chain must clear
    // UpdateEnabled at the type level to stop the write terminals compiling
    // (even though each individual stage preserves UpdateEnabled).
    const pastLeadingMatch = handle()
      .match(MongoFieldFilter.eq('status', 'new'))
      .addFields((f) => ({ doubled: f.amount }))
      .match(MongoFieldFilter.gt('amount', 100));
    // @ts-expect-error — match past the leading-match prefix clears UpdateEnabled
    pastLeadingMatch.updateMany((f) => [f.amount.inc(1)]);
    // @ts-expect-error — match past the leading-match prefix clears UpdateEnabled
    pastLeadingMatch.updateOne((f) => [f.amount.inc(1)]);
  });

  it('FilteredCollection does not expose insert / unqualified-write terminals', () => {
    const f = filtered();
    // @ts-expect-error — inserts ignore filters; not meaningful after `.match(...)`
    f.insertOne({ status: 'new' });
    // @ts-expect-error — inserts ignore filters; not meaningful after `.match(...)`
    f.insertMany([{ status: 'new' }]);
    // @ts-expect-error — `updateAll` is the unqualified form; the qualified
    // form on `FilteredCollection` is `.updateMany(...)`
    f.updateAll((u) => [u.amount.set(0)]);
    // @ts-expect-error — `deleteAll` is the unqualified form; the qualified
    // form on `FilteredCollection` is `.deleteMany()`
    f.deleteAll();
  });
});
