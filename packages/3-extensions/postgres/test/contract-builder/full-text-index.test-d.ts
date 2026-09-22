/**
 * `fullTextIndex` keeps its `name` literal, so the model's `sql()` stage can see
 * the index's name and refuse a duplicate exactly as it does for
 * `constraints.index`. A `map:` index carries no wire name and so never collides.
 */
import type { ColumnRef } from '@internal/sql-contract-ts/contract-builder';
import { expectTypeOf, test } from 'vitest';
import { field, fullTextIndex, model } from '../../src/exports/contract-builder';

const intColumn = { codecId: 'pg/int4@1', nativeType: 'int4' } as const;
const textColumn = { codecId: 'pg/text@1', nativeType: 'text' } as const;

const fields = { id: field.column(intColumn).id(), text: field.column(textColumn) };

test('the name stays literal rather than widening to string', () => {
  const index = fullTextIndex<'message_search'>(
    { kind: 'columnRef', fieldName: 'text' },
    { name: 'message_search' },
  );
  expectTypeOf(index.name).toEqualTypeOf<'message_search' | undefined>();
});

test('a map: index carries no wire name', () => {
  const index = fullTextIndex({ kind: 'columnRef', fieldName: 'text' }, { map: 'message_search' });
  expectTypeOf(index.name).toEqualTypeOf<undefined>();
});

/**
 * Duplicate-name detection does not currently fire for indexes from either
 * helper: `constraints.index` is reachable only inside `sql(callback)`, which
 * widens the returned tuple, and `IndexConstraint.name` is optional, so
 * `NamedConstraintLiteralName` sees `Name | undefined` rather than a literal.
 * Keeping `Name` literal here is the half this helper owns; the day the check
 * starts biting, it bites this helper too.
 */
test('two indexes with distinct names are accepted in the object form', () => {
  const text: ColumnRef<'text'> = { kind: 'columnRef', fieldName: 'text' };

  model('Message', { fields }).sql({
    table: 'message',
    indexes: [
      fullTextIndex(text, { name: 'message_search' }),
      fullTextIndex(text, { language: 'german', name: 'message_search_de' }),
    ],
  });
});
