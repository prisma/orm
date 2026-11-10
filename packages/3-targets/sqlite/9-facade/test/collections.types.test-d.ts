import { Collection } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import type { Contract } from '../../1-target/test/fixtures/sqlite-contract.d';
import contractJson from '../../1-target/test/fixtures/sqlite-contract.json' with { type: 'json' };
import sqlite, { type SqliteClient } from '../src/exports/runtime';
import { contractFromJson } from '../src/exports/static';

class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string) {
    return this.where({ title });
  }
}

const contract = contractFromJson<Contract>(contractJson);
const db = sqlite({ contract, collections: { Post: PostCollection } });

test('a class method is typed on db.orm and tx.orm', async () => {
  expectTypeOf(db).toEqualTypeOf<SqliteClient<Contract, { Post: typeof PostCollection }>>();
  expectTypeOf(db.orm.Post.titled).parameters.toEqualTypeOf<[title: string]>();
  // @ts-expect-error the class has no such method
  db.orm.Post.missing();
  // @ts-expect-error the class method is only on the model it is registered for
  db.orm.User.titled('Hello');

  await db.transaction(async (tx) => {
    expectTypeOf(tx.orm.Post.titled('Hello')).toHaveProperty('titled');
    // @ts-expect-error the class has no such method
    tx.orm.Post.missing();
  });
});

test('a client with classes is accepted where a client without classes is expected', () => {
  const takesClient = (_client: SqliteClient<Contract>) => undefined;
  takesClient(db);
});

test('a client without classes has no class methods', () => {
  const plain = sqlite({ contract });
  expectTypeOf(plain).toEqualTypeOf<SqliteClient<Contract>>();
  // @ts-expect-error no class is registered
  plain.orm.Post.titled('Hello');
});
