import { Collection } from '@internal/sql-orm-client';
import { expectTypeOf, test } from 'vitest';
import postgres, { type PostgresClient } from '../src/exports/runtime';
import postgresServerless, {
  type PostgresServerlessClient,
  type PostgresServerlessConnection,
} from '../src/exports/serverless';
import { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

class PostCollection extends Collection<Contract, 'Post'> {
  titled(title: string) {
    return this.where({ title });
  }
}

const contract = contractFromJson<Contract>(contractJson);
const db = postgres({ contract, collections: { Post: PostCollection } });
declare const connection: Awaited<
  ReturnType<
    ReturnType<typeof postgresServerless<Contract, { Post: typeof PostCollection }>>['connect']
  >
>;

test('a class method is typed on db.orm and tx.orm', async () => {
  expectTypeOf(db.orm.public.Post.titled).parameters.toEqualTypeOf<[title: string]>();
  // @ts-expect-error the class has no such method
  db.orm.public.Post.missing();
  // @ts-expect-error the class method is only on the model it is registered for
  db.orm.public.User.titled('Hello');

  await db.transaction(async (tx) => {
    expectTypeOf(tx.orm.public.Post.titled('Hello').forUpdate()).toHaveProperty('titled');
    // @ts-expect-error the class has no such method
    tx.orm.public.Post.missing();
  });
});

test('a class method is typed on a serverless connection and its transactions', async () => {
  const serverless = postgresServerless({ contract, collections: { Post: PostCollection } });
  expectTypeOf(serverless).toEqualTypeOf<
    PostgresServerlessClient<Contract, { Post: typeof PostCollection }>
  >();
  expectTypeOf(connection).toEqualTypeOf<
    PostgresServerlessConnection<Contract, { Post: typeof PostCollection }>
  >();
  expectTypeOf(connection.orm.public.Post.titled).toBeFunction();
  await connection.transaction(async (tx) => {
    expectTypeOf(tx.orm.public.Post.titled).toBeFunction();
  });
});

test('a client with classes is accepted where a client without classes is expected', () => {
  const takesClient = (_client: PostgresClient<Contract>) => undefined;
  const takesConnection = (_connection: PostgresServerlessConnection<Contract>) => undefined;

  takesClient(db);
  takesConnection(connection);
});

test('a client without classes has no class methods', () => {
  const plain = postgres({ contract });
  expectTypeOf(plain).toEqualTypeOf<PostgresClient<Contract>>();
  // @ts-expect-error no class is registered
  plain.orm.public.Post.titled('Hello');
});
