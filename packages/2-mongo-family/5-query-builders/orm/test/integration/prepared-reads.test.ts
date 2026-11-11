import mongoRuntimeAdapter from '@internal/adapter-mongo/runtime';
import mongoRuntimeDriver from '@internal/driver-mongo/runtime';
import type { MongoExecutionContext, MongoPreparable } from '@internal/mongo-query-ast/execution';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import type { MongoCodecTypesBase } from '@internal/mongo-contract';
import {
  createMongoExecutionContext,
  createMongoExecutionStack,
  createMongoRuntime,
  type MongoDeclaration,
  type MongoParamsFromDeclaration,
  type MongoPlaceholders,
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

function user(name: string, city: string, tags: string[]) {
  return {
    name,
    email: `${name.toLowerCase()}@example.com`,
    loginCount: 0,
    tags,
    homeAddress: { city, country: 'FR' },
  };
}

describe('prepared ORM reads', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let runtime: MongoRuntime;
  let context: MongoExecutionContext<typeof contract>;
  const dbName = 'orm_prepared_reads_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    const stack = createMongoExecutionStack({
      target: mongoRuntimeTarget,
      adapter: mongoRuntimeAdapter,
      driver: mongoRuntimeDriver,
    });
    context = createMongoExecutionContext({ contract, stack });
    const driver = stack.driver.create();
    await driver.connect({ kind: 'url', url: replSet.getUri(), dbName });
    runtime = createMongoRuntime({ context, adapter: stack.adapter.create(stack), driver });
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    await client.db(dbName).dropDatabase();
    const users = mongoOrm({ context, runtime }).users;
    await users.createAndCount([
      user('Ann', 'Paris', ['admin']),
      user('Bob', 'Lyon', ['staff']),
      user('Cid', 'Paris', ['staff', 'admin']),
    ]);
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), client?.close(), replSet?.stop()]);
  }, timeouts.spinUpMongoMemoryServer);

  async function prepareRead<const D extends MongoDeclaration, Result>(
    declaration: D,
    read: (placeholders: MongoPlaceholders<D>) => MongoPreparable<Record<string, unknown>, Result>,
  ): Promise<(params: MongoParamsFromDeclaration<D, MongoCodecTypesBase>) => Result> {
    let described: MongoPreparable<Record<string, unknown>, Result> | undefined;
    const statement = await runtime.prepare(declaration, (placeholders) => {
      described = read(placeholders);
      return described.plan;
    });
    return (params) => described!.consume(statement.query(runtime, params));
  }

  it('runs a filter-expression where on a value-object scalar and a limit with the values of each run', async () => {
    const users = mongoOrm({ context, runtime }).users;
    const run = await prepareRead({ city: 'mongo/string@1', take: 'mongo/int32@1' }, (p) =>
      users
        .where(MongoFieldFilter.eq('homeAddress.city', p.city))
        .select('name')
        .orderBy({ name: 1 })
        .limit(p.take)
        .prepared.all(),
    );

    const runs = {
      paris: await run({ city: 'Paris', take: 5 }).toArray(),
      lyon: await run({ city: 'Lyon', take: 5 }).toArray(),
      parisFirst: await run({ city: 'Paris', take: 1 }).toArray(),
    };

    expect(runs).toEqual({
      paris: [{ name: 'Ann' }, { name: 'Cid' }],
      lyon: [{ name: 'Bob' }],
      parisFirst: [{ name: 'Ann' }],
    });
  });

  it('runs a placeholder on a list field and in an offset', async () => {
    const users = mongoOrm({ context, runtime }).users;
    const run = await prepareRead({ tag: 'mongo/string@1', skip: 'mongo/int32@1' }, (p) =>
      users
        .where({ tags: p.tag })
        .select('name')
        .orderBy({ name: 1 })
        .offset(p.skip)
        .prepared.all(),
    );

    expect({
      admins: await run({ tag: 'admin', skip: 0 }).toArray(),
      staffAfterFirst: await run({ tag: 'staff', skip: 1 }).toArray(),
    }).toEqual({
      admins: [{ name: 'Ann' }, { name: 'Cid' }],
      staffAfterFirst: [{ name: 'Cid' }],
    });
  });

  it('runs first() with an object-form where', async () => {
    const users = mongoOrm({ context, runtime }).users;
    const run = await prepareRead({ name: 'mongo/string@1' }, (p) =>
      users
        .where({ name: p.name })
        .select('name', 'email')
        .prepared.first(),
    );

    expect({ found: await run({ name: 'Bob' }), missing: await run({ name: 'Zed' }) }).toEqual({
      found: { name: 'Bob', email: 'bob@example.com' },
      missing: null,
    });
  });

  it('refuses a limit placeholder that first() replaces, as unused', async () => {
    const users = mongoOrm({ context, runtime }).users;

    await expect(
      prepareRead({ take: 'mongo/int32@1' }, (p) => users.limit(p.take).prepared.first()),
    ).rejects.toMatchObject({
      code: 'RUNTIME.PREPARE_UNUSED_PARAM',
      details: { unused: ['take'] },
    });
  });
});
