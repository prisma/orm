import { expectTypeOf, test } from 'vitest';
import type { WhereFilter } from '../../src/exports/types';
import type { Contract } from '../fixtures/generated/contract';

test('WhereFilter binds fields and operators to a contract table', () => {
  const userById =
    (id: number): WhereFilter<Contract, 'public', 'users'> =>
    (fields, operators) =>
      operators.eq(fields.id, id);

  expectTypeOf(userById).parameter(0).toEqualTypeOf<number>();
});

test('WhereFilter rejects fields outside the contract table', () => {
  const invalidUserById =
    (id: number): WhereFilter<Contract, 'public', 'users'> =>
    (fields, operators) =>
      // @ts-expect-error — users has no userId column
      operators.eq(fields.userId, id);

  expectTypeOf(invalidUserById).parameter(0).toEqualTypeOf<number>();
});
