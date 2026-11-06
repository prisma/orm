import type { MutationUpdateInput } from '@prisma/orm-postgres/orm-client';
import type { PostgresClient } from '@prisma/orm-postgres/runtime';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../src/prisma/contract.d';

declare const db: PostgresClient<Contract>;

function renameUser(displayName: string): MutationUpdateInput<Contract, 'User'> {
  return { displayName };
}

test('update input helpers pass to update()', () => {
  const updated = db.orm.public.User.where({ email: 'alice@example.com' }).update(
    renameUser('Alice'),
  );

  expectTypeOf(updated).not.toBeNever();
});

test('invalid update input fields fail where the input is constructed', () => {
  function invalidRenameUser(name: string): MutationUpdateInput<Contract, 'User'> {
    return {
      // @ts-expect-error User has no name field
      name,
    };
  }

  expectTypeOf(invalidRenameUser).returns.toEqualTypeOf<MutationUpdateInput<Contract, 'User'>>();
});
