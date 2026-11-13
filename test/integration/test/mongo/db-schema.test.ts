import mongoAdapterDescriptor, { introspectSchema } from '@internal/adapter-mongo/control';
import { createMongoFamilyInstance, mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { createControlStack, hasSchemaView } from '@internal/framework-components/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';

function createInstance() {
  const stack = createControlStack({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapterDescriptor,
  });
  return createMongoFamilyInstance(stack);
}

describe('db schema for Mongo (end-to-end)', { timeout: timeouts.spinUpMongoMemoryServer }, () => {
  let replSet: MongoMemoryReplSet;
  let client: MongoClient;
  let db: Db;
  const dbName = 'db_schema_integration_test';

  beforeAll(async () => {
    replSet = await MongoMemoryReplSet.create({
      instanceOpts: [
        { launchTimeout: timeouts.spinUpMongoMemoryServer, storageEngine: 'wiredTiger' },
      ],
      replSet: { count: 1 },
    });
    client = new MongoClient(replSet.getUri());
    await client.connect();
    db = client.db(dbName);
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await client?.close();
    await replSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    const collections = await db.listCollections().toArray();
    for (const col of collections) {
      const name = col['name'] as string;
      if (name.startsWith('system.')) continue;
      await db.dropCollection(name);
    }
  }, timeouts.databaseOperation);

  it('introspects live schema and produces a CoreSchemaView tree', async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });
    await db.createCollection('posts');
    await db.collection('posts').createIndex({ authorId: 1 });

    const schema = await introspectSchema(db);
    const instance = createInstance();

    expect(hasSchemaView(instance)).toBe(true);

    const view = instance.toSchemaView(schema);

    expect(view.root.kind).toBe('root');
    expect(view.root.id).toBe('mongo-schema');
    expect(view.root.children).toHaveLength(2);

    const usersNode = view.root.children!.find((n) => n.label === 'collection users');
    expect(usersNode).toBeDefined();
    expect(usersNode!.children).toHaveLength(1);

    const emailIdx = usersNode!.children![0]!;
    expect(emailIdx.kind).toBe('index');
    expect(emailIdx.label).toContain('unique index');
    expect(emailIdx.label).toContain('email');

    const postsNode = view.root.children!.find((n) => n.label === 'collection posts');
    expect(postsNode).toBeDefined();
    expect(postsNode!.children).toHaveLength(1);

    const authorIdIdx = postsNode!.children![0]!;
    expect(authorIdIdx.kind).toBe('index');
    expect(authorIdIdx.label).toContain('authorId');
  });

  it('produces an empty tree for empty database', async () => {
    const schema = await introspectSchema(db);
    const instance = createInstance();
    const view = instance.toSchemaView(schema);

    expect(view.root.kind).toBe('root');
    expect(view.root.children).toBeUndefined();
  });

  it('includes validators and collection options in the tree', async () => {
    await db.createCollection('products', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['name'],
          properties: { name: { bsonType: 'string' } },
        },
      },
      validationLevel: 'strict',
      validationAction: 'error',
    });

    await db.createCollection('logs', {
      capped: true,
      size: 1048576,
    });

    const schema = await introspectSchema(db);
    const instance = createInstance();
    const view = instance.toSchemaView(schema);

    const productsNode = view.root.children!.find((n) => n.label === 'collection products');
    expect(productsNode).toBeDefined();
    const validatorNode = productsNode!.children!.find((n) => n.id === 'validator-products');
    expect(validatorNode).toBeDefined();
    expect(validatorNode!.label).toContain('strict');

    const logsNode = view.root.children!.find((n) => n.label === 'collection logs');
    expect(logsNode).toBeDefined();
    const optionsNode = logsNode!.children!.find((n) => n.id === 'options-logs');
    expect(optionsNode).toBeDefined();
    expect(optionsNode!.label).toContain('capped');
  });

  it('lists every BSON type of a validator property that admits several', async () => {
    await db.createCollection('events', {
      validator: {
        $jsonSchema: {
          bsonType: 'object',
          required: ['payload'],
          properties: {
            payload: {
              bsonType: ['object', 'array', 'string', 'double', 'int', 'long', 'bool', 'null'],
            },
            note: { bsonType: ['null', 'string'] },
          },
        },
      },
    });

    const schema = await introspectSchema(db);
    const instance = createInstance();
    const view = instance.toSchemaView(schema);

    const eventsNode = view.root.children!.find((n) => n.label === 'collection events');
    const validatorNode = eventsNode!.children!.find((n) => n.id === 'validator-events');
    expect(validatorNode!.children!.map((n) => n.label)).toEqual([
      'payload: object | array | string | double | int | long | bool | null (required)',
      'note: null | string',
    ]);
  });

  it('produces JSON-serializable output', async () => {
    await db.createCollection('users');
    await db.collection('users').createIndex({ email: 1 }, { unique: true });

    const schema = await introspectSchema(db);
    const instance = createInstance();
    const view = instance.toSchemaView(schema);

    const json = JSON.stringify({
      ok: true,
      summary: 'Schema read successfully',
      schema,
      schemaView: view,
      target: { familyId: 'mongo', id: 'mongo' },
      meta: {},
      timings: { total: 0 },
    });

    const parsed = JSON.parse(json) as { ok: boolean; schema: unknown };
    expect(parsed.ok).toBe(true);
    expect(parsed.schema).toBeDefined();
  });
});
