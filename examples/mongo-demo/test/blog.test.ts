import mongo from '@prisma/orm-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../src/contract';
import contractJson from '../src/contract.json' with { type: 'json' };

describe('mongo-demo blog integration', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  const dbName = 'blog_test';
  const mongoDb = mongo<Contract>({ contractJson });
  const orm = mongoDb.orm;

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();

    await mongoDb.connect({ uri: replSet.getUri(), dbName });
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([mongoDb.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  it('all() returns seeded users with embedded address value objects', async () => {
    const aliceAddress = {
      street: '123 Main St',
      city: 'San Francisco',
      zip: '94102',
      country: 'US',
    };
    await orm.users.createAll([
      {
        name: 'Alice',
        email: 'alice@example.com',
        bio: 'Writer',
        role: 'author',
        address: aliceAddress,
      },
      { name: 'Bob', email: 'bob@example.com', bio: null, role: 'author', address: null },
    ]);

    const users = await orm.users.all();
    const sorted = [...users].sort((a, b) => String(a.name).localeCompare(String(b.name)));

    expect(sorted).toHaveLength(2);
    expect(sorted[0]).toMatchObject({
      name: 'Alice',
      email: 'alice@example.com',
      bio: 'Writer',
      address: aliceAddress,
    });
    expect(sorted[1]).toMatchObject({
      name: 'Bob',
      email: 'bob@example.com',
      bio: null,
      address: null,
    });
  });

  it('all() returns seeded posts', async () => {
    const alice = await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: null,
      role: 'author',
      address: null,
    });
    await orm.posts.createAll([
      {
        title: 'Hello World',
        content: 'My first post',
        kind: 'article',
        authorId: alice._id as string,
        createdAt: new Date('2026-01-15'),
      },
      {
        title: 'Second Post',
        content: 'More content',
        kind: 'tutorial',
        authorId: alice._id as string,
        createdAt: new Date('2026-02-01'),
      },
    ]);

    const posts = await orm.posts.all();
    const sorted = [...posts].sort((a, b) => String(a.title).localeCompare(String(b.title)));

    expect(sorted).toHaveLength(2);
    expect(sorted[0]).toMatchObject({
      title: 'Hello World',
      content: 'My first post',
      kind: 'article',
    });
    expect(sorted[1]).toMatchObject({
      title: 'Second Post',
      content: 'More content',
      kind: 'tutorial',
    });
  });

  it('include() resolves Post -> User via $lookup', async () => {
    const alice = await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: 'Writer',
      role: 'author',
      address: null,
    });
    await orm.posts.create({
      title: 'Hello World',
      content: 'My first post',
      kind: 'article',
      authorId: alice._id as string,
      createdAt: new Date('2026-01-15'),
    });

    const posts = await orm.posts.include('author').all();

    expect(posts).toHaveLength(1);
    expect(posts[0]).toMatchObject({
      title: 'Hello World',
      author: { name: 'Alice', email: 'alice@example.com' },
    });
  });

  it('full flow: seed users and posts, query with include', async () => {
    const createdUsers = await orm.users.createAll([
      {
        name: 'Alice',
        email: 'alice@example.com',
        bio: 'Writer',
        role: 'author',
        address: { street: '123 Main St', city: 'San Francisco', zip: '94102', country: 'US' },
      },
      { name: 'Bob', email: 'bob@example.com', bio: null, role: 'author', address: null },
    ]);
    const alice = createdUsers[0];
    const bob = createdUsers[1];
    if (!alice || !bob) throw new Error('Expected 2 users');

    await orm.posts.createAll([
      {
        title: 'Hello World',
        content: 'My first post',
        kind: 'article',
        authorId: alice._id as string,
        createdAt: new Date('2026-01-15'),
      },
      {
        title: 'Mongo with Prisma 8',
        content: 'Using the contract-first approach',
        kind: 'tutorial',
        authorId: bob._id as string,
        createdAt: new Date('2026-02-20'),
      },
    ]);

    const users = await orm.users.all();
    expect(users).toHaveLength(2);

    const posts = await orm.posts.include('author').all();
    expect(posts).toHaveLength(2);

    const alicePost = posts.find((p) => String(p.authorId) === String(alice._id));
    expect(alicePost).toMatchObject({
      title: 'Hello World',
      author: { name: 'Alice' },
    });

    const bobPost = posts.find((p) => String(p.authorId) === String(bob._id));
    expect(bobPost).toMatchObject({
      title: 'Mongo with Prisma 8',
      author: { name: 'Bob' },
    });
  });

  it('variant() filters posts by discriminator', async () => {
    const alice = await orm.users.create({
      name: 'Alice',
      email: 'alice@example.com',
      bio: null,
      role: 'author',
      address: null,
    });

    await orm.posts.createAll([
      {
        title: 'Article One',
        content: 'Article content',
        kind: 'article',
        authorId: alice._id as string,
        createdAt: new Date('2026-01-15'),
      },
      {
        title: 'Tutorial One',
        content: 'Tutorial content',
        kind: 'tutorial',
        authorId: alice._id as string,
        createdAt: new Date('2026-02-01'),
      },
      {
        title: 'Article Two',
        content: 'Another article',
        kind: 'article',
        authorId: alice._id as string,
        createdAt: new Date('2026-03-01'),
      },
    ]);

    const articles = await orm.posts.variant('Article').all();
    expect(articles).toHaveLength(2);
    for (const a of articles) {
      expect(a.kind).toBe('article');
    }

    const tutorials = await orm.posts.variant('Tutorial').all();
    expect(tutorials).toHaveLength(1);
    expect(tutorials[0]).toMatchObject({ title: 'Tutorial One', kind: 'tutorial' });
  });
});
