import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import { expectTypeOf, test } from 'vitest';
import { createCollectionFor } from './collection-fixtures';

test('prepared terminals preserve projections and nested includes', () => {
  const { collection } = createCollectionFor('User');
  const selected = collection.select('name').include('posts', (posts) => posts.select('title'));
  const all = selected.prepared.all();
  const first = selected.prepared.first({ id: 1 });
  expectTypeOf(all.consume).returns.toEqualTypeOf<
    AsyncIterableResult<{ name: string; posts: { title: string }[] }>
  >();
  expectTypeOf(first.consume).returns.toEqualTypeOf<
    Promise<{ name: string; posts: { title: string }[] } | null>
  >();
  // @ts-expect-error the prepared view is terminal-only
  selected.prepared.where({ id: 1 });
  // @ts-expect-error mutations are not preparation terminals
  selected.prepared.create({});
  const aggregate = selected.prepared.aggregate((agg) => ({
    total: agg.count(),
    min: agg.min('id'),
  }));
  expectTypeOf(aggregate.consume).returns.toEqualTypeOf<
    Promise<{ total: number; min: number | null }>
  >();
  // @ts-expect-error aggregate field operands remain model field names
  selected.prepared.aggregate((agg) => ({ min: agg.min('missing') }));
  // @ts-expect-error first rejects unknown fields
  selected.prepared.first({ missing: 1 });
});
