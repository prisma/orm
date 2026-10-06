import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import { createMongoDriver } from '@internal/driver-mongo';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoRuntime,
} from '@internal/mongo-runtime';
import mongoRuntimeTarget from '@internal/target-mongo/runtime';
import { timeouts } from '@repo/test-utils';
import { MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import type { Contract } from '../../../../1-foundation/mongo-contract/test/fixtures/orm-contract';
import ormContractJson from '../../../../1-foundation/mongo-contract/test/fixtures/orm-contract.json';
import { mongoOrm } from '../../src/mongo-orm';

const contract = ormContractJson as unknown as Contract;

describe('Mongo ORM polymorphism integration', {
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let runtime: MongoRuntime;
  const dbName = 'polymorphism_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();

    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
    });
    const context = createMongoExecutionContext({ contract: {}, stack });
    const driver = await createMongoDriver(replSet.getUri(), dbName);
    runtime = createMongoRuntime({ context, driver });
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  it('base query returns rows with discriminator values', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const user = await orm.users.create({
      name: 'Alice',
      email: 'alice@test.com',
      loginCount: 0,
      tags: [] as string[],
      homeAddress: null,
    });

    await orm.tasks.create({
      title: 'Fix crash',
      type: 'bug',
      assigneeId: user._id as string,
    } as never);
    await orm.tasks.create({
      title: 'Add login',
      type: 'feature',
      assigneeId: user._id as string,
    } as never);

    const tasks = await orm.tasks.all();
    expect(tasks).toHaveLength(2);
    const types = tasks.map((t) => t.type).sort();
    expect(types).toEqual(['bug', 'feature']);
  });

  it('variant("bug") filters to only Bug rows', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const user = await orm.users.create({
      name: 'Alice',
      email: 'alice@test.com',
      loginCount: 0,
      tags: [] as string[],
      homeAddress: null,
    });

    await orm.tasks.create({
      title: 'Fix crash',
      type: 'bug',
      assigneeId: user._id as string,
    } as never);
    await orm.tasks.create({
      title: 'Add login',
      type: 'feature',
      assigneeId: user._id as string,
    } as never);

    const bugs = await orm.tasks.variant('bug').all();
    expect(bugs).toHaveLength(1);
    expect(bugs[0]!.type).toBe('bug');
    expect(bugs[0]!.title).toBe('Fix crash');
  });

  it('variant("feature") filters to only Feature rows', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const user = await orm.users.create({
      name: 'Alice',
      email: 'alice@test.com',
      loginCount: 0,
      tags: [] as string[],
      homeAddress: null,
    });

    await orm.tasks.create({
      title: 'Fix crash',
      type: 'bug',
      assigneeId: user._id as string,
    } as never);
    await orm.tasks.create({
      title: 'Add login',
      type: 'feature',
      assigneeId: user._id as string,
    } as never);

    const features = await orm.tasks.variant('feature').all();
    expect(features).toHaveLength(1);
    expect(features[0]!.type).toBe('feature');
    expect(features[0]!.title).toBe('Add login');
  });

  it('variant create injects discriminator and persists it', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const user = await orm.users.create({
      name: 'Alice',
      email: 'alice@test.com',
      loginCount: 0,
      tags: [] as string[],
      homeAddress: null,
    });

    const bug = await orm.tasks.variant('bug').create({
      title: 'Null pointer',
      severity: 'critical',
      assigneeId: user._id as string,
    } as never);

    expect((bug as Record<string, unknown>)['type']).toBe('bug');

    const doc = await client.db(dbName).collection('tasks').findOne({ title: 'Null pointer' });
    expect(doc).not.toBeNull();
    expect(doc!['type']).toBe('bug');
    expect(doc!['severity']).toBe('critical');
  });

  it('round-trip: create via variant, read back via base', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const user = await orm.users.create({
      name: 'Alice',
      email: 'alice@test.com',
      loginCount: 0,
      tags: [] as string[],
      homeAddress: null,
    });

    await orm.tasks.variant('bug').create({
      title: 'Memory leak',
      severity: 'high',
      assigneeId: user._id as string,
    } as never);

    await orm.tasks.variant('feature').create({
      title: 'Dashboard',
      priority: 'p1',
      targetRelease: 'v2.0',
      assigneeId: user._id as string,
    } as never);

    const allTasks = await orm.tasks.all();
    expect(allTasks).toHaveLength(2);

    const sorted = [...allTasks].sort((a, b) => a.title.localeCompare(b.title));
    expect(sorted[0]).toMatchObject({ title: 'Dashboard', type: 'feature' });
    expect(sorted[1]).toMatchObject({ title: 'Memory leak', type: 'bug' });
  });

  it('non-polymorphic model unaffected by polymorphism changes', async () => {
    const orm = mongoOrm({ contract, executor: runtime });

    await orm.users.createAll([
      {
        name: 'Alice',
        email: 'alice@test.com',
        loginCount: 0,
        tags: [] as string[],
        homeAddress: null,
      },
      {
        name: 'Bob',
        email: 'bob@test.com',
        loginCount: 0,
        tags: [] as string[],
        homeAddress: null,
      },
    ]);

    const users = await orm.users.all();
    expect(users).toHaveLength(2);
    const names = users.map((u) => u.name).sort();
    expect(names).toEqual(['Alice', 'Bob']);
  });

  it('variant().first() returns narrowed result', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const user = await orm.users.create({
      name: 'Alice',
      email: 'alice@test.com',
      loginCount: 0,
      tags: [] as string[],
      homeAddress: null,
    });

    await orm.tasks.variant('bug').create({
      title: 'Fix crash',
      severity: 'high',
      assigneeId: user._id as string,
    } as never);

    const bug = await orm.tasks.variant('bug').first();
    expect(bug).not.toBeNull();
    expect(bug!.type).toBe('bug');
    expect(bug!.title).toBe('Fix crash');
  });

  it('variant createAll injects discriminator into each document', async () => {
    const orm = mongoOrm({ contract, executor: runtime });
    const user = await orm.users.create({
      name: 'Alice',
      email: 'alice@test.com',
      loginCount: 0,
      tags: [] as string[],
      homeAddress: null,
    });

    await orm.tasks.variant('bug').createAll([
      { title: 'Bug 1', severity: 'low', assigneeId: user._id as string },
      { title: 'Bug 2', severity: 'high', assigneeId: user._id as string },
    ] as never);

    const bugs = await orm.tasks.variant('bug').all();
    expect(bugs).toHaveLength(2);
    for (const b of bugs) {
      expect(b.type).toBe('bug');
    }

    const allTasks = await orm.tasks.all();
    expect(allTasks).toHaveLength(2);
  });
});
