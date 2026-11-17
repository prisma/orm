import { test } from 'vitest';
import { createCollectionFor } from './collection-fixtures';

// Post-group limit()/offset() require a prior orderBy() on the grouped
// collection — a database may return groups in any order, so "page 2 of the
// groups" is undefined without one. Mirrors the hasOrderBy gate cursor()
// uses at the root position (collection.ts:865-869).

test('post-group pagination requires a prior orderBy', () => {
  const { collection } = createCollectionFor('Post');

  const ordered = collection.groupBy('userId').orderBy((group) => group.userId.asc());
  ordered.limit(2);
  ordered.offset(2);

  const unordered = collection.groupBy('userId');
  // @ts-expect-error limit() requires a prior orderBy() on the grouped collection
  unordered.limit(2);
  // @ts-expect-error offset() requires a prior orderBy() on the grouped collection
  unordered.offset(2);

  // An empty orderBy() selector list orders by nothing — it must not satisfy
  // the gate above, or `.groupBy('x').orderBy([]).limit(1)` would compile and
  // page groups with no defined order.
  // @ts-expect-error orderBy() requires a non-empty selector list
  collection.groupBy('userId').orderBy([]);
});
