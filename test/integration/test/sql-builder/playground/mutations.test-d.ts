import type { SqlQueryPlan } from '@internal/sql-relational-core/plan';
import { expectTypeOf, test } from 'vitest';
import { db } from './preamble';

test('INSERT array form without returning resolves to empty row', () => {
  const result = db.public.users.insert([{ id: 1, name: 'Alice', email: 'a@b.com' }]).build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<Record<never, never>>>();
});

test('INSERT array form with returning resolves to selected columns', () => {
  const result = db.public.users
    .insert([{ id: 1, name: 'Alice', email: 'a@b.com' }])
    .returning('id', 'email')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
});

test('INSERT array form build return type', () => {
  const result = db.public.users
    .insert([{ id: 1, name: 'Alice', email: 'a@b.com' }])
    .returning('id', 'name')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
});

test('INSERT array form build returns SqlQueryPlan', () => {
  const result = db.public.users
    .insert([{ id: 1, name: 'Alice', email: 'a@b.com' }])
    .returning('id')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
});

test('INSERT multi-row with returning resolves to selected columns', () => {
  const result = db.public.users
    .insert([
      { id: 1, name: 'Alice', email: 'a@b.com' },
      { id: 2, name: 'Bob', email: 'b@b.com' },
    ])
    .returning('id')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number }>>();
});

test('UPDATE without returning resolves to empty row', () => {
  const result = db.public.users
    .update({ name: 'Bob' })
    .where((f, fns) => fns.eq(f.id, 1))
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<Record<never, never>>>();
});

test('UPDATE with WHERE and returning resolves to selected columns', () => {
  const result = db.public.users
    .update({ name: 'Bob' })
    .where((f, fns) => fns.eq(f.id, 1))
    .returning('id', 'name')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
});

test('UPDATE returning before where preserves row type', () => {
  const result = db.public.users
    .update({ email: 'new@test.com' })
    .returning('id', 'email')
    .where((f, fns) => fns.eq(f.id, 1))
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
});

test('DELETE without returning resolves to empty row', () => {
  const result = db.public.users
    .delete()
    .where((f, fns) => fns.eq(f.id, 1))
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<Record<never, never>>>();
});

test('DELETE with WHERE and returning resolves to selected columns', () => {
  const result = db.public.users
    .delete()
    .where((f, fns) => fns.eq(f.id, 1))
    .returning('id', 'email')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; email: string }>>();
});

test('INSERT returning includes nullable column', () => {
  const result = db.public.users
    .insert([{ id: 1, name: 'Alice', email: 'a@b.com' }])
    .returning('id', 'invited_by_id')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; invited_by_id: number | null }>>();
});

test('INSERT array values accept codec input types', () => {
  // number for int4, string for text — should compile
  db.public.users.insert([{ id: 1, name: 'Alice', email: 'a@b.com' }]);

  // nullable column accepts a value or may be left out
  db.public.users.insert([{ id: 1, name: 'Alice', email: 'a@b.com', invited_by_id: 42 }]);
  db.public.users.insert([{ id: 1, name: 'Alice', email: 'a@b.com' }]); // invited_by_id omitted — it is nullable, so optional
});

test('UPDATE values accept codec input types', () => {
  db.public.users.update({ name: 'Bob' });
  db.public.users.update({ email: 'new@test.com', name: 'Bob' });
});

test('returning only accepts valid column names', () => {
  // @ts-expect-error — 'nonexistent' is not a column
  db.public.users.insert([{ id: 1, name: 'Alice', email: 'a@b.com' }]).returning('nonexistent');

  // @ts-expect-error — 'nonexistent' is not a column
  db.public.users.update({ name: 'Bob' }).returning('nonexistent');

  // @ts-expect-error — 'nonexistent' is not a column
  db.public.users.delete().returning('nonexistent');
});

// Negative type tests — bare-object insert form must be rejected
test('INSERT bare object form is a type error', () => {
  // @ts-expect-error — bare object is no longer accepted; wrap in array: insert([{ ... }])
  db.public.users.insert({ id: 1, name: 'Alice', email: 'a@b.com' });
});

// UPDATE callback overload — type-level tests

test('UPDATE callback overload type-checks with field reference', () => {
  const result = db.public.users.update((f) => ({ name: f.name })).build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<Record<never, never>>>();
});

test('UPDATE callback overload type-checks with where and returning', () => {
  const result = db.public.users
    .update((f) => ({ name: f.name }))
    .where((f, fns) => fns.eq(f.id, 1))
    .returning('id', 'name')
    .build();
  expectTypeOf(result).toEqualTypeOf<SqlQueryPlan<{ id: number; name: string }>>();
});

// Negative type tests — callback overload must enforce codec compatibility
test('UPDATE callback codec mismatch is a type error', () => {
  // @ts-expect-error — f.name is a text expression; id expects a numeric expression
  db.public.users.update((f) => ({ id: f.name }));
});

test('UPDATE callback aggregate function is a type error', () => {
  db.public.users
    // @ts-expect-error — count() is not in Functions (non-aggregate only); update callback cannot use aggregates
    .update((_f, fns) => ({ name: fns.count() }));
});
