import type { MutationUpdateInput } from '@prisma/orm-postgres/orm-client';
import { expectTypeOf, test } from 'vitest';
import { createOrmClient } from '../src/orm-client/client';
import type { Contract } from '../src/prisma/contract';

function renameUser(displayName: string): MutationUpdateInput<Contract, 'User'> {
  return { displayName };
}

test('update input helpers pass to update()', () => {
  const db = createOrmClient(null as never);
  const updated = db.User.where({ email: 'alice@example.com' }).update(renameUser('Alice'));

  expectTypeOf(updated).not.toBeNever();
});

test('invalid update input fields fail where the input is constructed', () => {
  function invalidRenameUser(name: string): MutationUpdateInput<Contract, 'User'> {
    return {
      // @ts-expect-error — User has no name field
      name,
    };
  }

  const db = createOrmClient(null as never);
  db.User.where({ email: 'alice@example.com' }).update(invalidRenameUser('Alice'));
});
