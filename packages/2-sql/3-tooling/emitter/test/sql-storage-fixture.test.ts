import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { namespacedSqlStorage } from './sql-storage-fixture';

function normalizedTables(tables: Record<string, unknown>) {
  return namespacedSqlStorage({ tables }).namespaces[UNBOUND_NAMESPACE_ID]?.entries['table'];
}

describe('SQL storage fixture cardinality', () => {
  it('defaults absent many to false', () => {
    expect(normalizedTables({ Item: { columns: { tags: { nativeType: 'text' } } } })).toEqual({
      Item: { columns: { tags: { nativeType: 'text', many: false } } },
    });
  });

  it.each([
    null,
    undefined,
    false,
    { elementNullable: false },
    { elementNullable: true },
    true,
    'invalid',
    0,
  ])('preserves an explicit many value %j', (many) => {
    const tables = { Item: { columns: { tags: { nativeType: 'text', many } } } };
    expect(normalizedTables(tables)).toStrictEqual(tables);
  });

  it.each([null, false, 'invalid', []])(
    'preserves malformed table and column fixtures %j',
    (value) => {
      const tables = {
        invalid: value,
        invalidColumns: { columns: value },
        Item: { columns: { tags: value } },
      };
      expect(normalizedTables(tables)).toStrictEqual(tables);
    },
  );
});
