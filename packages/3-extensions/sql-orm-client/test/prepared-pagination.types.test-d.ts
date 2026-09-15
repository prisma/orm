import type { BindSiteParams } from '@internal/sql-runtime';
import { test } from 'vitest';
import { createCollectionFor } from './collection-fixtures';

declare const params: BindSiteParams<{
  page: 'pg/int4@1';
  skip: 'pg/int8number@1';
  text: 'pg/text@1';
  optional: { codecId: 'pg/int4@1'; nullable: true };
}>;

test('pagination accepts SQL numeric expressions and rejects nullable and nonnumeric operands', () => {
  const { collection } = createCollectionFor('User');
  collection.limit(params.page).offset(params.skip).select('id').prepared.all();
  collection.limit(2).offset(params.page).select('id').prepared.first();
  collection.include('posts', (posts) => posts.limit(params.page).offset(params.skip).select('id'));
  collection.include('posts', (posts) => posts.limit(params.page).offset(0).count());
  collection.include('posts', (posts) =>
    posts.combine({
      rows: posts.limit(params.page).select('id'),
      count: posts.offset(params.skip).count(),
    }),
  );
  // @ts-expect-error nullable numeric expressions are not pagination operands
  collection.limit(params.optional);
  // @ts-expect-error nullable numeric expressions are not pagination operands
  collection.offset(params.optional);
  // @ts-expect-error textual expressions are not numeric
  collection.limit(params.text);
  // @ts-expect-error textual expressions are not numeric
  collection.offset(params.text);
  // @ts-expect-error nested pagination retains numeric constraints
  collection.include('posts', (posts) => posts.limit(params.text).select('id'));
  // @ts-expect-error nested pagination retains nullability constraints
  collection.include('posts', (posts) => posts.offset(params.optional).select('id'));
});
