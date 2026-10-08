/**
 * End-to-end no-emit authoring chain type tests.
 *
 * The no-emit chain is the strongest evidence the typed flow works as designed: authoring a contract via the TS callback surface (`defineContract` + `field.*` builders) produces a contract whose model + field types flow through to the SQL builder lane, so that:
 *
 * - `field.id.uuidv4String()` resolves to a string-shaped field;
 * - `fns.eq(f.id, '<uuid string>')` typechecks at the where clause;
 * - `fns.eq(f.id, 1234)` fails to typecheck (id is a string, not a number).
 *
 * The contract is the demo's own no-emit `contract` value (typed via `defineContract` callback inference, not via `contract.d.ts`).
 */

import { expectTypeOf, test } from 'vitest';
import type { contract } from '../prisma/contract';
import { sql } from '../src/prisma-no-emit/context';

test('field.id.uuidv4String() produces a string-typed id field on User', () => {
  type UserStorageFields =
    (typeof contract.domain.namespaces)['public']['models']['User']['storage']['fields'];
  expectTypeOf<UserStorageFields>().toHaveProperty('id');
  type IdField = UserStorageFields['id'];
  expectTypeOf<IdField>().toHaveProperty('column');
  // Assert the column resolves to a string at the typed-leaf boundary, not just "has a column property". Without this assertion the test would pass for any field whose IR carries a `column` slot, defeating the no-emit-chain evidence claim. Use `toExtend` rather than `toEqualTypeOf` because the storage field type narrows the column to `string` at the leaf — a stricter codec type that resolves to a string-extending shape is acceptable.
  expectTypeOf<IdField['column']>().toExtend<string>();
  // Confirm the column is *not* `never` (which is the failure mode if the codec lookup mis-resolves and the type system widens to bottom).
  expectTypeOf<IdField['column']>().not.toBeNever();
});

test('fns.eq(f.id, "<uuid>") typechecks on the User table', () => {
  const plan = sql.user
    .select('id', 'email')
    .where((f, fns) => fns.eq(f.id, 'b3a1f8e0-1234-4f5a-9876-abcdef012345'))
    .limit(1)
    .build();
  expectTypeOf(plan).not.toBeNever();
});

test('fns.eq(f.id, 1234) fails to typecheck — id is a string, not a number', () => {
  sql.user
    .select('id', 'email')
    // @ts-expect-error -- id is string-typed; comparing to a number violates the typed flow
    .where((f, fns) => fns.eq(f.id, 1234))
    .limit(1)
    .build();
});

test('authoring chain preserves model + field types end-to-end', () => {
  expectTypeOf<keyof (typeof contract.domain.namespaces)['public']['models']>().toExtend<
    'User' | 'Post'
  >();
  type PostStorageFields =
    (typeof contract.domain.namespaces)['public']['models']['Post']['storage']['fields'];
  expectTypeOf<PostStorageFields>().toHaveProperty('title');
  expectTypeOf<PostStorageFields>().toHaveProperty('userId');
});
