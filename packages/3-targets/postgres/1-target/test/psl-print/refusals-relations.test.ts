import { describe, expect, it } from 'vitest';
import {
  INT_COLUMN,
  INT_FIELD,
  PUBLIC,
  printingWidget,
  refusal,
  type WidgetParts,
} from './refusal-support';

/** A `Widget` with the given relations, and a `Post` that holds `widgetId` and has no relation. */
function widgetWithRelations(relations: Record<string, unknown>, post: WidgetParts['table'] = {}) {
  return printingWidget({
    model: { relations },
    models: {
      Post: {
        storage: {
          table: 'Post',
          namespaceId: 'public',
          fields: { id: { column: 'id' }, widgetId: { column: 'widgetId' } },
        },
        fields: { id: INT_FIELD, widgetId: INT_FIELD },
        relations: {},
      },
    },
    tables: {
      Post: {
        columns: { id: INT_COLUMN, widgetId: INT_COLUMN },
        uniques: [],
        indexes: [],
        foreignKeys: [],
        primaryKey: { columns: ['id'] },
        ...post,
      },
    },
    contract: {
      roots: {
        Widget: { namespace: PUBLIC, model: 'Widget' },
        Post: { namespace: PUBLIC, model: 'Post' },
      },
    },
  });
}

describe('relations with no owning side', () => {
  it.each(['1:N', '1:1'])(
    'refuses a %s relation when the other model has no relation that holds the foreign key',
    (cardinality) => {
      expect(
        widgetWithRelations({
          posts: {
            to: { namespace: PUBLIC, model: 'Post' },
            cardinality,
            on: { localFields: ['id'], targetFields: ['widgetId'] },
          },
        }),
      ).toThrow(refusal({ model: 'Widget', field: 'posts' }));
    },
  );

  it('refuses a relation that names no fields to join on', () => {
    expect(
      widgetWithRelations({
        posts: { to: { namespace: PUBLIC, model: 'Post' }, cardinality: '1:N' },
      }),
    ).toThrow(refusal({ model: 'Widget', field: 'posts' }));
  });
});
