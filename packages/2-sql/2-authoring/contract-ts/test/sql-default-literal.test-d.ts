import type { ColumnDefault } from '@internal/contract/types';
import { expectTypeOf, test } from 'vitest';
import { sql } from '../src/sql-default-literal';

test('sql`...` returns a ColumnDefault and refuses interpolation', () => {
  expectTypeOf(sql`gen_random_uuid()`).toEqualTypeOf<ColumnDefault>();
  const column = 'created_at';
  // @ts-expect-error interpolation is not allowed in a sql default
  sql`coalesce(${column}, now())`;
});
