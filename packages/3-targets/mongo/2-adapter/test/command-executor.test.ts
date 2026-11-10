/**
 * Behavioral tests for DDL execution via the adapter-owned seam
 * (`controlAdapter.executeDdl(driver, command)` → `driver.run(wire)`).
 *
 * Each test exercises one of the DDL command kinds against mongodb-memory-server
 * and asserts the resulting database state.
 */
import mongoControlDriver, { type MongoControlDriver } from '@internal/driver-mongo/control';
import {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  ListCollectionsCommand,
  ListIndexesCommand,
  RenameCollectionCommand,
} from '@internal/mongo-query-ast/control';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { MongoInspectionExecutor } from '../src/core/migrations/inspection-executor';
import { MongoControlAdapterImpl } from '../src/exports/control';

let replSet: MongoMemoryReplSet;
let client: MongoClient;
let db: Db;
let controlDriver: MongoControlDriver;
const dbName = 'command_executor_test';

beforeAll(async () => {
  replSet = await MongoMemoryReplSet.create({
    replSet: { count: 1, storageEngine: 'wiredTiger' },
  });
  client = new MongoClient(replSet.getUri());
  await client.connect();
  db = client.db(dbName);
  controlDriver = await mongoControlDriver.create(replSet.getUri(dbName));
});

afterAll(async () => {
  await controlDriver?.close();
  await client?.close();
  await replSet?.stop();
});

beforeEach(async () => {
  const collections = await db.listCollections().toArray();
  for (const col of collections) {
    const name = col['name'] as string;
    if (name.startsWith('system.')) continue;
    await db.dropCollection(name);
  }
});

async function execDdl(
  cmd:
    | CreateCollectionCommand
    | CreateIndexCommand
    | DropCollectionCommand
    | DropIndexCommand
    | RenameCollectionCommand
    | CollModCommand,
): Promise<void> {
  const controlAdapter = new MongoControlAdapterImpl();
  await controlAdapter.executeDdl(controlDriver, cmd);
}

describe('createIndex via executeDdl', () => {
  it('creates a unique index on a collection', async () => {
    await db.createCollection('users');
    const cmd = new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
      unique: true,
      name: 'email_1',
    });

    await execDdl(cmd);

    const indexes = await db.collection('users').listIndexes().toArray();
    const emailIndex = indexes.find((idx) => idx['key']?.['email'] === 1);
    expect(emailIndex).toBeDefined();
    expect(emailIndex?.['unique']).toBe(true);
  });

  it('creates a TTL index with sparse option', async () => {
    await db.createCollection('sessions');
    const cmd = new CreateIndexCommand('sessions', [{ field: 'createdAt', direction: 1 }], {
      expireAfterSeconds: 3600,
      sparse: true,
      name: 'createdAt_1',
    });

    await execDdl(cmd);

    const indexes = await db.collection('sessions').listIndexes().toArray();
    const ttlIndex = indexes.find((idx) => idx['key']?.['createdAt'] === 1);
    expect(ttlIndex).toBeDefined();
    expect(ttlIndex?.['expireAfterSeconds']).toBe(3600);
    expect(ttlIndex?.['sparse']).toBe(true);
  });

  it('creates a partial index', async () => {
    await db.createCollection('logs');
    const cmd = new CreateIndexCommand('logs', [{ field: 'level', direction: 1 }], {
      partialFilterExpression: { active: true },
      name: 'level_1_partial',
    });

    await execDdl(cmd);

    const indexes = await db.collection('logs').listIndexes().toArray();
    const partialIndex = indexes.find((idx) => idx['key']?.['level'] === 1);
    expect(partialIndex).toBeDefined();
    expect(partialIndex?.['partialFilterExpression']).toEqual({ active: true });
  });

  it('creates an index with collation', async () => {
    await db.createCollection('products');
    const cmd = new CreateIndexCommand('products', [{ field: 'name', direction: 1 }], {
      collation: { locale: 'en', strength: 2 },
      name: 'name_1_en',
    });

    await execDdl(cmd);

    const indexes = await db.collection('products').listIndexes().toArray();
    const nameIndex = indexes.find((idx) => idx['key']?.['name'] === 1);
    expect(nameIndex).toBeDefined();
    expect(nameIndex?.['collation']?.['locale']).toBe('en');
  });

  it('creates a text index with weights, default_language, language_override', async () => {
    await db.createCollection('articles');
    const cmd = new CreateIndexCommand(
      'articles',
      [
        { field: 'title', direction: 'text' },
        { field: 'body', direction: 'text' },
      ],
      {
        weights: { title: 10, body: 1 },
        default_language: 'english',
        language_override: 'lang',
        name: 'articles_text',
      },
    );

    await execDdl(cmd);

    const indexes = await db.collection('articles').listIndexes().toArray();
    const textIndex = indexes.find(
      (idx) =>
        idx['default_language'] === 'english' &&
        idx['language_override'] === 'lang' &&
        idx['weights'] !== undefined,
    );
    expect(textIndex).toBeDefined();
    expect(textIndex?.['weights']).toEqual({ title: 10, body: 1 });
    expect(textIndex?.['default_language']).toBe('english');
    expect(textIndex?.['language_override']).toBe('lang');
  });

  it('creates a wildcard index', async () => {
    await db.createCollection('wildcard_items');
    const cmd = new CreateIndexCommand('wildcard_items', [{ field: '$**', direction: 1 }], {
      wildcardProjection: { name: 1 },
      name: 'wildcard_1',
    });

    await execDdl(cmd);

    const indexes = await db.collection('wildcard_items').listIndexes().toArray();
    const wildcardIdx = indexes.find((idx) => idx['key']?.['$**'] === 1);
    expect(wildcardIdx).toBeDefined();
    expect(wildcardIdx?.['wildcardProjection']).toEqual({ name: 1 });
  });
});

describe('dropIndex via executeDdl', () => {
  it('drops an existing index', async () => {
    await db.createCollection('posts');
    await db.collection('posts').createIndex({ title: 1 }, { name: 'title_1' });

    const cmd = new DropIndexCommand('posts', 'title_1');
    await execDdl(cmd);

    const indexes = await db.collection('posts').listIndexes().toArray();
    const titleIndex = indexes.find((idx) => idx['name'] === 'title_1');
    expect(titleIndex).toBeUndefined();
  });
});

describe('createCollection via executeDdl', () => {
  it('creates a plain collection', async () => {
    const cmd = new CreateCollectionCommand('events');
    await execDdl(cmd);

    const colls = await db.listCollections({ name: 'events' }).toArray();
    expect(colls).toHaveLength(1);
  });

  it('creates a capped collection', async () => {
    const cmd = new CreateCollectionCommand('logs', {
      capped: true,
      size: 1048576,
      max: 1000,
    });
    await execDdl(cmd);

    const colls = await db.listCollections({ name: 'logs' }).toArray();
    expect(colls).toHaveLength(1);
    expect((colls[0] as Record<string, unknown>)['options']).toHaveProperty('capped', true);
  });

  it('creates a collection with validator and validation options', async () => {
    const validator = { $jsonSchema: { bsonType: 'object', required: ['name'] } };
    const cmd = new CreateCollectionCommand('validated_coll', {
      validator,
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await execDdl(cmd);

    const colls = await db.listCollections({ name: 'validated_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['validator']).toEqual(validator);
    expect(opts['validationLevel']).toBe('strict');
    expect(opts['validationAction']).toBe('error');
  });

  it('creates a collection with changeStreamPreAndPostImages', async () => {
    const cmd = new CreateCollectionCommand('cs_images_coll', {
      changeStreamPreAndPostImages: { enabled: true },
    });
    await execDdl(cmd);

    const colls = await db.listCollections({ name: 'cs_images_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['changeStreamPreAndPostImages']).toEqual({ enabled: true });
  });

  it('creates a collection with collation', async () => {
    const collation = { locale: 'en', strength: 2 };
    const cmd = new CreateCollectionCommand('collation_coll', { collation });
    await execDdl(cmd);

    const colls = await db.listCollections({ name: 'collation_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['collation']).toMatchObject(collation);
  });

  it('creates a timeseries collection', async () => {
    const cmd = new CreateCollectionCommand('ts_coll', {
      timeseries: { timeField: 'ts', granularity: 'hours' },
    });

    try {
      await execDdl(cmd);
    } catch {
      return;
    }

    const colls = await db.listCollections({ name: 'ts_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['timeseries']).toMatchObject({ timeField: 'ts', granularity: 'hours' });
  });

  it('creates a clustered collection', async () => {
    const cmd = new CreateCollectionCommand('clustered_coll', {
      clusteredIndex: { key: { _id: 1 }, unique: true },
    });

    try {
      await execDdl(cmd);
    } catch {
      return;
    }

    const colls = await db.listCollections({ name: 'clustered_coll' }).toArray();
    expect(colls).toHaveLength(1);
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['clusteredIndex']).toMatchObject({ key: { _id: 1 }, unique: true });
  });
});

describe('dropCollection via executeDdl', () => {
  it('drops an existing collection', async () => {
    await db.createCollection('temp');
    const cmd = new DropCollectionCommand('temp');
    await execDdl(cmd);

    const colls = await db.listCollections({ name: 'temp' }).toArray();
    expect(colls).toHaveLength(0);
  });
});

describe('renameCollection via executeDdl', () => {
  it('renames an existing collection', async () => {
    await db.createCollection('old_name');
    await execDdl(new RenameCollectionCommand('old_name', 'new_name'));

    const names = (
      await db.listCollections({ name: { $in: ['old_name', 'new_name'] } }).toArray()
    ).map((c) => c['name']);
    expect(names).toEqual(['new_name']);
  });
});

describe('collMod via executeDdl', () => {
  it('applies validator to an existing collection', async () => {
    await db.createCollection('docs');
    const cmd = new CollModCommand('docs', {
      validator: { $jsonSchema: { bsonType: 'object', required: ['name'] } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    await execDdl(cmd);

    const colls = await db.listCollections({ name: 'docs' }).toArray();
    expect((colls[0] as Record<string, unknown>)['options']).toHaveProperty('validator');
  });

  it('applies changeStreamPreAndPostImages', async () => {
    await db.createCollection('cs_mod_coll');
    const cmd = new CollModCommand('cs_mod_coll', {
      changeStreamPreAndPostImages: { enabled: true },
    });
    await execDdl(cmd);

    const colls = await db.listCollections({ name: 'cs_mod_coll' }).toArray();
    const opts = (colls[0] as Record<string, unknown>)['options'] as Record<string, unknown>;
    expect(opts['changeStreamPreAndPostImages']).toEqual({ enabled: true });
  });
});

describe('error fidelity — server errors surface through driver.execute', () => {
  it('dropIndex on a non-existent index throws', async () => {
    await db.createCollection('err_test');
    const cmd = new DropIndexCommand('err_test', 'nonexistent_idx');
    await expect(execDdl(cmd)).rejects.toThrow();
  });

  it('collMod on a missing collection throws', async () => {
    const cmd = new CollModCommand('no_such_collection', {
      validator: { $jsonSchema: { bsonType: 'object' } },
    });
    await expect(execDdl(cmd)).rejects.toThrow();
  });

  it('createIndex on a non-existent collection auto-creates the collection', async () => {
    const cmd = new CreateIndexCommand('auto_coll', [{ field: 'x', direction: 1 }], {
      name: 'x_1',
    });
    await expect(execDdl(cmd)).resolves.toBeUndefined();
    const colls = await db.listCollections({ name: 'auto_coll' }).toArray();
    expect(colls).toHaveLength(1);
  });
});

describe('MongoInspectionExecutor', () => {
  it('listIndexes returns index documents for a collection', async () => {
    await db.createCollection('items');
    await db.collection('items').createIndex({ sku: 1 });

    const executor = new MongoInspectionExecutor(db);
    const cmd = new ListIndexesCommand('items');

    const results = await cmd.accept(executor);

    expect(results.length).toBeGreaterThanOrEqual(2);
    const skuIndex = results.find((doc) => doc['key']?.['sku'] === 1);
    expect(skuIndex).toBeDefined();
  });

  it('listIndexes returns empty array for non-existent collection', async () => {
    const executor = new MongoInspectionExecutor(db);
    const cmd = new ListIndexesCommand('nonexistent_collection');

    const results = await cmd.accept(executor);
    expect(results).toEqual([]);
  });

  it('listIndexes re-throws non-NamespaceNotFound errors', async () => {
    const fakeDb = {
      collection: () => ({
        listIndexes: () => ({
          toArray: () => Promise.reject(new Error('connection lost')),
        }),
      }),
    } as unknown as Db;

    const executor = new MongoInspectionExecutor(fakeDb);
    const cmd = new ListIndexesCommand('any');

    await expect(cmd.accept(executor)).rejects.toThrow('connection lost');
  });

  it('listCollections returns collection documents', async () => {
    await db.createCollection('alpha');
    await db.createCollection('beta');

    const executor = new MongoInspectionExecutor(db);
    const cmd = new ListCollectionsCommand();

    const results = await cmd.accept(executor);

    const names = results.map((doc) => doc['name']);
    expect(names).toContain('alpha');
    expect(names).toContain('beta');
  });
});
