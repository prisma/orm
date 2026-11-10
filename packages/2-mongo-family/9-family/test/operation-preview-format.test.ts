import {
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  type MongoMigrationPlanOperation,
  RenameCollectionCommand,
} from '@internal/mongo-query-ast/control';
import { RawInsertOneCommand, RawUpdateManyCommand } from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { formatMongoOperations } from '../src/core/operation-preview';

describe('formatMongoOperations', () => {
  it('formats createIndex with unique option', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'index.users.create(email:1)',
      label: 'Create index',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
            unique: true,
            name: 'email_1',
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual([
      'db.getCollection("users").createIndex({ "email": 1 }, { unique: true, name: "email_1" })',
    ]);
  });

  it('formats createIndex without options', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('posts', [{ field: 'title', direction: 1 }]),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual(['db.getCollection("posts").createIndex({ "title": 1 })']);
  });

  it('formats dropIndex', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: 'drop index',
          command: new DropIndexCommand('users', 'email_1'),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual(['db.getCollection("users").dropIndex("email_1")']);
  });

  it('formats compound index', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create compound index',
          command: new CreateIndexCommand(
            'users',
            [
              { field: 'email', direction: 1 },
              { field: 'tenantId', direction: -1 },
            ],
            { unique: true },
          ),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual([
      'db.getCollection("users").createIndex({ "email": 1, "tenantId": -1 }, { unique: true })',
    ]);
  });

  it('formats multiple operations', () => {
    const ops: MongoMigrationPlanOperation[] = [
      {
        id: 'op1',
        label: 'op1',
        operationClass: 'additive',
        precheck: [],
        execute: [
          {
            description: 'create',
            command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]),
          },
        ],
        postcheck: [],
      },
      {
        id: 'op2',
        label: 'op2',
        operationClass: 'destructive',
        precheck: [],
        execute: [
          {
            description: 'drop',
            command: new DropIndexCommand('posts', 'title_1'),
          },
        ],
        postcheck: [],
      },
    ];
    const result = formatMongoOperations(ops);
    expect(result).toHaveLength(2);
    expect(result[0]).toContain('createIndex');
    expect(result[1]).toContain('dropIndex');
  });

  it('writes every collection name as an escaped string', () => {
    const step = (command: MongoMigrationPlanOperation['execute'][number]['command']) => ({
      id: 'test',
      label: 'test',
      operationClass: 'widening' as const,
      precheck: [],
      execute: [{ description: 'step', command }],
      postcheck: [],
    });
    expect(
      formatMongoOperations([
        step(new DropCollectionCommand('my-coll')),
        step(new DropIndexCommand('a"b', 'x_1')),
        step(new CreateIndexCommand('my-coll', [{ field: 'x', direction: 1 }])),
        step(new RenameCollectionCommand('my-coll', 'a"b')),
      ]),
    ).toEqual([
      'db.getCollection("my-coll").drop()',
      'db.getCollection("a\\"b").dropIndex("x_1")',
      'db.getCollection("my-coll").createIndex({ "x": 1 })',
      'db.getCollection("my-coll").renameCollection("a\\"b")',
    ]);
  });

  it('formats a document rewrite as updateMany', () => {
    const plan = {
      collection: 'my-coll',
      command: new RawUpdateManyCommand(
        'my-coll',
        { name: { $exists: true } },
        { $rename: { name: 'fullName' } },
        { bypassDocumentValidation: true },
      ),
      meta: { target: 'mongo', storageHash: '', lane: 'mongo-raw' },
    };
    const rewrite = {
      id: 'field.my-coll.name.rename(fullName)',
      label: 'Rename field',
      operationClass: 'widening' as const,
      name: 'rename',
      precheck: [],
      run: [plan],
      postcheck: [],
    };
    expect(formatMongoOperations([rewrite])).toEqual([
      'db.getCollection("my-coll").updateMany({"name":{"$exists":true}}, {"$rename":{"name":"fullName"}}, { bypassDocumentValidation: true })',
    ]);
  });

  it('renders nothing for a user data transform, even one with an updateMany step', () => {
    const meta = { target: 'mongo', storageHash: 'h', lane: 'mongo-raw' };
    const transform = {
      id: 'data_transform.backfill',
      label: 'Data transform: backfill',
      operationClass: 'data' as const,
      name: 'backfill',
      precheck: [],
      run: [
        {
          collection: 'users',
          command: new RawUpdateManyCommand('users', {}, { $set: { status: 'active' } }),
          meta,
        },
        {
          collection: 'users',
          command: new RawInsertOneCommand('users', { name: 'seed' }),
          meta,
        },
      ],
      postcheck: [],
    };
    expect(formatMongoOperations([transform])).toEqual([]);
  });

  it('skips operations without execute steps', () => {
    const ops = [{ id: 'test', label: 'test', operationClass: 'additive' as const }];
    const result = formatMongoOperations(ops);
    expect(result).toEqual([]);
  });

  it('formats createIndex with sparse and TTL options', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('sessions', [{ field: 'expiresAt', direction: 1 }], {
            sparse: true,
            expireAfterSeconds: 3600,
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual([
      'db.getCollection("sessions").createIndex({ "expiresAt": 1 }, { sparse: true, expireAfterSeconds: 3600 })',
    ]);
  });

  it('formats createIndex with M2 options (collation, weights, wildcardProjection)', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create text index',
          command: new CreateIndexCommand('users', [{ field: 'bio', direction: 'text' }], {
            weights: { bio: 10 },
            default_language: 'english',
            language_override: 'lang',
            collation: { locale: 'en', strength: 2 },
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result[0]).toContain('createIndex');
    expect(result[0]).toContain('default_language: "english"');
    expect(result[0]).toContain('language_override: "lang"');
  });

  it('formats createCollection with options', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create collection',
          command: new CreateCollectionCommand('events', {
            capped: true,
            size: 1048576,
            validator: { $jsonSchema: { bsonType: 'object' } },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result[0]).toContain('db.createCollection("events"');
    expect(result[0]).toContain('capped: true');
  });

  it('formats createCollection with no options', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create collection',
          command: new CreateCollectionCommand('events'),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual(['db.createCollection("events")']);
  });

  it('formats dropCollection', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: 'drop collection',
          command: new DropCollectionCommand('events'),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toEqual(['db.getCollection("events").drop()']);
  });

  it('formats renameCollection', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'collection.profiles.rename',
      label: 'Rename collection',
      operationClass: 'widening',
      precheck: [],
      execute: [
        {
          description: 'rename collection',
          command: new RenameCollectionCommand('profiles', 'users'),
        },
      ],
      postcheck: [],
    };
    expect(formatMongoOperations([op])).toEqual([
      'db.getCollection("profiles").renameCollection("users")',
    ]);
  });

  it('formats collMod with validator', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: 'update validator',
          command: new CollModCommand('users', {
            validator: { $jsonSchema: { bsonType: 'object' } },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result[0]).toContain('db.runCommand({ collMod: "users"');
    expect(result[0]).toContain('validationLevel: "strict"');
  });

  it('formats createIndex with wildcardProjection and partialFilterExpression', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create wildcard index',
          command: new CreateIndexCommand('users', [{ field: '$**', direction: 1 }], {
            wildcardProjection: { bio: 1, name: 0 },
            partialFilterExpression: { active: true },
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result[0]).toContain('wildcardProjection:');
    expect(result[0]).toContain('"bio":1');
    expect(result[0]).toContain('partialFilterExpression:');
    expect(result[0]).toContain('"active":true');
  });

  it('formats createCollection with changeStreamPreAndPostImages', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create collection',
          command: new CreateCollectionCommand('events', {
            changeStreamPreAndPostImages: { enabled: true },
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result[0]).toContain('changeStreamPreAndPostImages:');
    expect(result[0]).toContain('"enabled":true');
  });

  it('formats collMod with changeStreamPreAndPostImages', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: 'enable change stream images',
          command: new CollModCommand('users', {
            changeStreamPreAndPostImages: { enabled: true },
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result[0]).toContain('db.runCommand({ collMod: "users"');
    expect(result[0]).toContain('changeStreamPreAndPostImages:');
    expect(result[0]).toContain('"enabled":true');
  });

  it('formats createCollection with max, timeseries, collation, and clusteredIndex', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create collection',
          command: new CreateCollectionCommand('events', {
            capped: true,
            size: 1048576,
            max: 5000,
            timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'seconds' },
            collation: { locale: 'en', strength: 2 },
            clusteredIndex: { key: { _id: 1 }, unique: true },
          }),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result[0]).toContain('max: 5000');
    expect(result[0]).toContain('timeseries:');
    expect(result[0]).toContain('collation:');
    expect(result[0]).toContain('clusteredIndex:');
  });

  it('skips execute steps without a command', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        { description: 'no-op step' } as unknown as (typeof op.execute)[number],
        {
          description: 'create index',
          command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }]),
        },
      ],
      postcheck: [],
    };
    const result = formatMongoOperations([op]);
    expect(result).toHaveLength(1);
    expect(result[0]).toContain('createIndex');
  });
});
