import type { CreateIndexOptions } from '@internal/mongo-query-ast/control';
import { describe, expectTypeOf, test } from 'vitest';
import type {
  IndexOptionFilter,
  IndexOptionFilters,
} from '../src/core/migrations/migration-factories';

declare const filter: IndexOptionFilter;
declare const table: IndexOptionFilters;

describe('IndexOptionFilters', () => {
  test('is the table of every listed option for CreateIndexOptions', () => {
    expectTypeOf(table).toExtend<IndexOptionFilters<CreateIndexOptions>>();
  });

  test('rejects a table missing the filter of a listed option', () => {
    // @ts-expect-error the table has no filter for `sparse` and the other options
    const partial: IndexOptionFilters = { unique: filter };
    expectTypeOf(partial).toExtend<object>();
  });

  test('rejects the table when CreateIndexOptions gains an option the list does not name', () => {
    // @ts-expect-error `hidden` is not in the list, so the table must give it as `never`
    const wider: IndexOptionFilters<CreateIndexOptions & { readonly hidden?: boolean }> = table;
    expectTypeOf(wider).toExtend<object>();
  });
});
