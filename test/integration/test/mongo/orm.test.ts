import { MongoContractSerializer } from '@internal/family-mongo/ir';
import { mongoOrm } from '@internal/mongo-orm';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { ObjectId } from 'mongodb';
import { expect, expectTypeOf, it } from 'vitest';
import type { Contract } from './fixtures/generated/contract';
import ormContractJson from './fixtures/generated/contract.json';
import { describeWithMongoDB } from './setup';

const contract = new MongoContractSerializer().deserializeContract(ormContractJson) as Contract;

describeWithMongoDB('mongoOrm integration', (ctx) => {
  it('loads generated collection indexes and options', () => {
    expect(contract.storage.namespaces.__unbound__.entries.collection.users).toEqual({
      kind: 'mongo-collection',
      indexes: [{ kind: 'mongo-index', keys: [{ field: 'email', direction: 1 }], unique: true }],
      options: {
        kind: 'mongo-collection-options',
        collation: { kind: 'mongo-collation-options', locale: 'en', strength: 2 },
      },
    });
  });

  it('all() on a non-polymorphic root returns typed results', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'Alice', email: 'alice@example.com', addresses: [] },
      { name: 'Bob', email: 'bob@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.users.orderBy({ name: 1 }).all();

    expect(results).toHaveLength(2);
    expect(results[0]).toMatchObject({ name: 'Alice', email: 'alice@example.com' });
    expect(results[1]).toMatchObject({ name: 'Bob', email: 'bob@example.com' });
  });

  it('where() with filter expression narrows results', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'Alice', email: 'alice@example.com', addresses: [] },
      { name: 'Bob', email: 'bob@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.users.where(MongoFieldFilter.eq('email', 'alice@example.com')).all();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({ name: 'Alice' });
  });

  it('include() on a reference relation returns related docs via $lookup', async () => {
    const db = ctx.client.db(ctx.dbName);
    const userId = new ObjectId();
    await db.collection('users').insertOne({
      _id: userId,
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [],
    });
    await db.collection('tasks').insertOne({
      title: 'Fix bug',
      type: 'bug',
      assigneeId: userId,
      severity: 'high',
      comments: [],
    });

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.tasks.include('assignee').all();

    expect(results).toHaveLength(1);
    expect(results[0]).toMatchObject({
      title: 'Fix bug',
      assignee: { name: 'Alice', email: 'alice@example.com' },
    });
  });

  it('embedded documents appear in default results without include', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertOne({
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [
        { street: '123 Main St', city: 'Springfield', zip: '12345' },
        { street: '456 Oak Ave', city: 'Shelbyville', zip: '67890' },
      ],
    });

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const users = await orm.users.all();

    expect(users).toHaveLength(1);
    expect(users[0]!.addresses).toHaveLength(2);
    expect(users[0]!.addresses[0]).toMatchObject({
      street: '123 Main St',
      city: 'Springfield',
    });
  });

  it('embedded comments appear on tasks without include', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('tasks').insertOne({
      title: 'Fix bug',
      type: 'bug',
      assigneeId: new ObjectId(),
      severity: 'high',
      comments: [{ _id: new ObjectId(), text: 'Found it!', createdAt: new Date('2025-01-01') }],
    });

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const tasks = await orm.tasks.all();

    expect(tasks).toHaveLength(1);
    expect(tasks[0]!.comments).toHaveLength(1);
    expect(tasks[0]!.comments[0]).toMatchObject({ text: 'Found it!' });
  });

  it('all() on a polymorphic root returns all variants', async () => {
    const db = ctx.client.db(ctx.dbName);
    const assigneeId = new ObjectId();
    await db.collection('tasks').insertMany([
      {
        title: 'Fix crash',
        type: 'bug',
        assigneeId,
        severity: 'critical',
        comments: [],
      },
      {
        title: 'Add dark mode',
        type: 'feature',
        assigneeId,
        priority: 'medium',
        targetRelease: 'v2.0',
        comments: [],
      },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const tasks = await orm.tasks.all();

    expect(tasks).toHaveLength(2);
    const bug = tasks.find((t) => t.type === 'bug');
    const feature = tasks.find((t) => t.type === 'feature');
    expect(bug).toMatchObject({ title: 'Fix crash', severity: 'critical' });
    expect(feature).toMatchObject({
      title: 'Add dark mode',
      priority: 'medium',
      targetRelease: 'v2.0',
    });
  });

  it('discriminator narrows variant types exclusively', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('tasks').insertOne({
      title: 'Fix crash',
      type: 'bug',
      assigneeId: new ObjectId(),
      severity: 'critical',
      comments: [],
    });

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.tasks.all();
    const r0 = results[0]!;

    if (r0.type === 'bug') {
      expect(r0.severity).toBe('critical');
      expectTypeOf(r0.severity).toBeString();
      // @ts-expect-error priority only exists on Feature variant
      r0.priority;
      // @ts-expect-error targetRelease only exists on Feature variant
      r0.targetRelease;
    }
  });

  it('where() with .not() excludes matching documents', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'Alice', email: 'alice@example.com', addresses: [] },
      { name: 'Bob', email: 'bob@example.com', addresses: [] },
      { name: 'Charlie', email: 'charlie@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.users.where(MongoFieldFilter.eq('name', 'Alice').not()).all();

    expect(results).toHaveLength(2);
    const names = results.map((r) => r.name).sort();
    expect(names).toEqual(['Bob', 'Charlie']);
  });

  it('orderBy() returns results in specified order', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'Charlie', email: 'charlie@example.com', addresses: [] },
      { name: 'Alice', email: 'alice@example.com', addresses: [] },
      { name: 'Bob', email: 'bob@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.users.orderBy({ name: 1 }).all();

    expect(results).toHaveLength(3);
    expect(results[0]!.name).toBe('Alice');
    expect(results[1]!.name).toBe('Bob');
    expect(results[2]!.name).toBe('Charlie');
  });

  it('offset() and limit() return correct subset', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'Alice', email: 'alice@example.com', addresses: [] },
      { name: 'Bob', email: 'bob@example.com', addresses: [] },
      { name: 'Charlie', email: 'charlie@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.users.orderBy({ name: 1 }).offset(1).limit(1).all();

    expect(results).toHaveLength(1);
    expect(results[0]!.name).toBe('Bob');
  });

  it('select() restricts returned fields', async () => {
    const db = ctx.client.db(ctx.dbName);
    await db.collection('users').insertMany([
      { name: 'Alice', email: 'alice@example.com', addresses: [] },
      { name: 'Bob', email: 'bob@example.com', addresses: [] },
    ]);

    const orm = mongoOrm({ contract, executor: ctx.runtime });
    const results = await orm.users.select('name').all();

    expect(results).toHaveLength(2);
    for (const row of results) {
      const keys = Object.keys(row as Record<string, unknown>);
      expect(keys).toContain('name');
      expect(keys).not.toContain('_id');
      expect(keys).not.toContain('email');
      expect(keys).not.toContain('addresses');
    }
  });

  it('full flow: ORM -> typed AST -> runtime -> driver -> typed results', async () => {
    const db = ctx.client.db(ctx.dbName);
    const userId = new ObjectId();
    await db.collection('users').insertOne({
      _id: userId,
      name: 'Alice',
      email: 'alice@example.com',
      addresses: [{ street: '123 Main', city: 'Town', zip: '00000' }],
    });
    await db.collection('tasks').insertOne({
      title: 'Ship it',
      type: 'feature',
      assigneeId: userId,
      priority: 'high',
      targetRelease: 'v1.0',
      comments: [{ _id: new ObjectId(), text: 'LGTM', createdAt: new Date() }],
    });

    const orm = mongoOrm({ contract, executor: ctx.runtime });

    const users = await orm.users.where(MongoFieldFilter.eq('name', 'Alice')).all();
    expect(users).toHaveLength(1);
    expect(users[0]!.addresses).toHaveLength(1);

    const tasks = await orm.tasks.include('assignee').all();
    expect(tasks).toHaveLength(1);
    expect(tasks[0]).toMatchObject({
      title: 'Ship it',
      assignee: { name: 'Alice' },
      comments: [{ text: 'LGTM' }],
    });
  });
});
