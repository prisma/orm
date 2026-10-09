import { describe, expectTypeOf, test } from 'vitest';
import { Collection } from '../src/collection';
import { orm } from '../src/orm';
import { createMockRuntime, getTestContext, type TestContract } from './helpers';

class ReaderCollection extends Collection<TestContract, 'User'> {
  async nameOfFirst() {
    const row = await this.first();
    return row?.name;
  }

  async namesOfAll() {
    const rows = await this.where({ email: 'ada@example.com' }).all().toArray();
    return rows.map((row) => row.name);
  }

  async emailOfUpdated() {
    const row = await this.where({ name: 'Ada' }).update({ email: 'ada@example.org' });
    return row?.email;
  }

  async postCountOfFirst() {
    const row = await this.include('posts').first();
    return row?.posts.length;
  }
}

async function nameOfFirst<C extends ReaderCollection>(users: C) {
  const row = await users.first();
  return row?.name;
}

async function namesOfAll<C extends ReaderCollection>(users: C) {
  const rows = await users.all().toArray();
  return rows.map((row) => row.name);
}

async function emailOfUpdated<C extends ReaderCollection>(users: C) {
  const row = await users.where({ name: 'Ada' }).update({ email: 'ada@example.org' });
  return row?.email;
}

const users = orm({
  runtime: createMockRuntime(),
  context: getTestContext(),
  collections: { User: ReaderCollection },
}).public.User;

describe('a row read inside a class method has readable fields', () => {
  test('first', async () => {
    expectTypeOf(await users.nameOfFirst()).toEqualTypeOf<string | undefined>();
  });

  test('all', async () => {
    expectTypeOf(await users.namesOfAll()).toEqualTypeOf<string[]>();
  });

  test('a write', async () => {
    expectTypeOf(await users.emailOfUpdated()).toEqualTypeOf<string | undefined>();
  });

  test('first after include', async () => {
    expectTypeOf(await users.postCountOfFirst()).toEqualTypeOf<number | undefined>();
  });
});

describe('a row read inside a generic function has readable fields', () => {
  test('first', async () => {
    expectTypeOf(await nameOfFirst(users)).toEqualTypeOf<string | undefined>();
  });

  test('all', async () => {
    expectTypeOf(await namesOfAll(users)).toEqualTypeOf<string[]>();
  });

  test('a write', async () => {
    expectTypeOf(await emailOfUpdated(users)).toEqualTypeOf<string | undefined>();
  });
});
