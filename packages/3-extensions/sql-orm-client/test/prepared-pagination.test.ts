import { collectOrderedParamRefs, PreparedParamRef } from '@internal/sql-relational-core/ast';
import { type Expression, expressionMarker } from '@internal/sql-relational-core/expression';
import { expect, it } from 'vitest';
import { createCollectionFor } from './collection-fixtures';

const ref = PreparedParamRef.of('page', { codecId: 'pg/int4@1' });
const page: Expression<{ codecId: 'pg/int4@1'; nullable: false }> = {
  [expressionMarker]: true,
  returnType: { codecId: 'pg/int4@1', nullable: false },
  buildAst: () => ref,
};

it('retains pagination AST through root, distinct, nested rows, scalar and combine descriptions', () => {
  const { collection, runtime } = createCollectionFor('User');
  const descriptions = [
    collection.limit(page).offset(page).select('id').prepared.all(),
    collection.distinct('id').limit(page).offset(0).select('id').prepared.all(),
    collection
      .include('posts', (posts) => posts.limit(page).offset(0).select('id'))
      .select('id')
      .prepared.all(),
    collection
      .include('posts', (posts) => posts.distinct('id').limit(2).offset(page).select('id'))
      .select('id')
      .prepared.all(),
    collection
      .include('posts', (posts) => posts.limit(page).offset(0).count())
      .select('id')
      .prepared.all(),
    collection
      .include('posts', (posts) =>
        posts.combine({
          rows: posts.distinct('id').limit(page).offset(0).select('id'),
          count: posts.limit(2).offset(page).count(),
        }),
      )
      .select('id')
      .prepared.all(),
  ];
  for (const description of descriptions) {
    expect(collectOrderedParamRefs(description.ast)).toEqual([ref]);
    expect(collectOrderedParamRefs(description.ast)[0]).toBe(ref);
  }
  expect(descriptions[0]?.ast).toMatchObject({ limit: ref, offset: ref });
  expect(runtime.executions).toEqual([]);
});

it('first replaces the prior limit without retaining its parameter', () => {
  const { collection } = createCollectionFor('User');
  const description = collection.limit(page).offset(0).select('id').prepared.first();
  expect(description.ast).toMatchObject({ limit: 1, offset: 0 });
  expect(collectOrderedParamRefs(description.ast)).toEqual([]);
});
