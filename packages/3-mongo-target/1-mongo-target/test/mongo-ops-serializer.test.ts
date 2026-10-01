import {
  type AnyMongoMigrationOperation,
  CollModCommand,
  CreateCollectionCommand,
  CreateIndexCommand,
  DropCollectionCommand,
  DropIndexCommand,
  ListCollectionsCommand,
  ListIndexesCommand,
  MongoAndExpr,
  MongoExistsExpr,
  MongoFieldFilter,
  type MongoMigrationPlanOperation,
  MongoOrExpr,
} from '@internal/mongo-query-ast/control';
import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it } from 'vitest';
import {
  deserializeMongoOps,
  serializeMongoOps,
} from '../src/core/migrations/mongo-ops-serializer';

function asDdlOp(op: AnyMongoMigrationOperation): MongoMigrationPlanOperation {
  if (op.operationClass === 'data') {
    throw new Error('Expected DDL operation, got data transform');
  }
  return op as MongoMigrationPlanOperation;
}

function makeCreateIndexOp(): MongoMigrationPlanOperation {
  return {
    id: 'index.users.create(email:1)',
    label: 'Create index on users (email ascending)',
    operationClass: 'additive',
    precheck: [
      {
        description: 'index does not already exist on users',
        source: new ListIndexesCommand('users'),
        filter: MongoFieldFilter.eq('key', { email: 1 }),
        expect: 'notExists',
      },
    ],
    execute: [
      {
        description: 'create index on users',
        command: new CreateIndexCommand('users', [{ field: 'email', direction: 1 }], {
          unique: true,
          name: 'email_1',
        }),
      },
    ],
    postcheck: [
      {
        description: 'index exists on users',
        source: new ListIndexesCommand('users'),
        filter: MongoAndExpr.of([
          MongoFieldFilter.eq('key', { email: 1 }),
          MongoFieldFilter.eq('unique', true),
        ]),
        expect: 'exists',
      },
    ],
  };
}

function makeDropIndexOp(): MongoMigrationPlanOperation {
  return {
    id: 'index.users.drop(email:1)',
    label: 'Drop index on users (email ascending)',
    operationClass: 'destructive',
    precheck: [
      {
        description: 'index exists on users',
        source: new ListIndexesCommand('users'),
        filter: MongoFieldFilter.eq('key', { email: 1 }),
        expect: 'exists',
      },
    ],
    execute: [
      {
        description: 'drop index on users',
        command: new DropIndexCommand('users', 'email_1'),
      },
    ],
    postcheck: [
      {
        description: 'index no longer exists on users',
        source: new ListIndexesCommand('users'),
        filter: MongoFieldFilter.eq('key', { email: 1 }),
        expect: 'notExists',
      },
    ],
  };
}

describe('serializeMongoOps / deserializeMongoOps', () => {
  it('round-trips a createIndex operation', () => {
    const original = [makeCreateIndexOp()];
    const serialized = serializeMongoOps(original);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);

    expect(deserialized).toHaveLength(1);
    const op = asDdlOp(deserialized[0]!);
    expect(op.id).toBe('index.users.create(email:1)');
    expect(op.label).toBe('Create index on users (email ascending)');
    expect(op.operationClass).toBe('additive');

    expect(op.precheck).toHaveLength(1);
    expect(op.precheck[0]!.source.kind).toBe('listIndexes');
    expect(op.precheck[0]!.expect).toBe('notExists');

    expect(op.execute).toHaveLength(1);
    expect(op.execute[0]!.command.kind).toBe('createIndex');
    const cmd = op.execute[0]!.command as CreateIndexCommand;
    expect(cmd.collection).toBe('users');
    expect(cmd.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(cmd.unique).toBe(true);

    expect(op.postcheck).toHaveLength(1);
    expect(op.postcheck[0]!.filter.kind).toBe('and');
    expect(op.postcheck[0]!.expect).toBe('exists');
  });

  it('round-trips a dropIndex operation', () => {
    const original = [makeDropIndexOp()];
    const serialized = serializeMongoOps(original);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);

    expect(deserialized).toHaveLength(1);
    const op = asDdlOp(deserialized[0]!);
    expect(op.id).toBe('index.users.drop(email:1)');
    expect(op.operationClass).toBe('destructive');

    const cmd = op.execute[0]!.command as DropIndexCommand;
    expect(cmd.kind).toBe('dropIndex');
    expect(cmd.collection).toBe('users');
    expect(cmd.name).toBe('email_1');
  });

  it('round-trips multiple operations', () => {
    const original = [makeCreateIndexOp(), makeDropIndexOp()];
    const serialized = serializeMongoOps(original);
    const deserialized = deserializeMongoOps(JSON.parse(serialized) as unknown[]);
    expect(deserialized).toHaveLength(2);
    expect(deserialized[0]!.id).toBe('index.users.create(email:1)');
    expect(deserialized[1]!.id).toBe('index.users.drop(email:1)');
  });

  it('round-trips $or filter expression', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [
        {
          description: 'test',
          source: new ListIndexesCommand('users'),
          filter: MongoOrExpr.of([
            MongoFieldFilter.eq('name', 'idx_a'),
            MongoFieldFilter.eq('name', 'idx_b'),
          ]),
          expect: 'notExists',
        },
      ],
      execute: [],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    expect(asDdlOp(deserialized[0]!).precheck[0]!.filter.kind).toBe('or');
  });

  it('round-trips $not filter expression', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [
        {
          description: 'test',
          source: new ListIndexesCommand('users'),
          filter: MongoFieldFilter.eq('name', 'x').not(),
          expect: 'exists',
        },
      ],
      execute: [],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    expect(asDdlOp(deserialized[0]!).precheck[0]!.filter.kind).toBe('not');
  });

  it('round-trips $exists filter expression', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [
        {
          description: 'test',
          source: new ListIndexesCommand('users'),
          filter: MongoExistsExpr.exists('unique'),
          expect: 'exists',
        },
      ],
      execute: [],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const filter = asDdlOp(deserialized[0]!).precheck[0]!.filter;
    expect(filter.kind).toBe('exists');
  });

  it('throws for unknown DDL command kind', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [],
        execute: [{ description: 'test', command: { kind: 'unknownCommand' } }],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Unknown DDL command kind/);
  });

  it('throws for unknown inspection command kind', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'unknownInspection' },
            filter: { kind: 'field', field: 'x', op: '$eq', value: 1 },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Unknown inspection command kind/);
  });

  it('throws for unknown filter expression kind', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'listIndexes', collection: 'users' },
            filter: { kind: 'unknownFilter' },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Unknown filter expression kind/);
  });

  it('raises MIGRATION.INVALID_OPERATION_ENTRY as a structured error for a malformed entry', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [],
        execute: [{ description: 'test', command: { kind: 'teleport' } }],
        postcheck: [],
      },
    ];
    let caught: unknown;
    try {
      deserializeMongoOps(json);
    } catch (error) {
      caught = error;
    }
    expect(isStructuredError(caught)).toBe(true);
    expect(caught).toMatchObject({
      code: 'MIGRATION.INVALID_OPERATION_ENTRY',
      meta: { context: 'DDL command', kind: 'teleport' },
    });
  });

  it('rejects createIndex with missing collection', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [],
        execute: [
          {
            description: 'test',
            command: { kind: 'createIndex', keys: [{ field: 'x', direction: 1 }] },
          },
        ],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid createIndex command/);
  });

  it('rejects createIndex with invalid direction', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [],
        execute: [
          {
            description: 'test',
            command: {
              kind: 'createIndex',
              collection: 'users',
              keys: [{ field: 'x', direction: 'invalid' }],
            },
          },
        ],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid createIndex command/);
  });

  it('rejects createIndex with empty keys array', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [],
        execute: [
          {
            description: 'test',
            command: { kind: 'createIndex', collection: 'users', keys: [] },
          },
        ],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid createIndex command/);
  });

  it('rejects dropIndex with missing name', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [],
        execute: [
          {
            description: 'test',
            command: { kind: 'dropIndex', collection: 'users' },
          },
        ],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid dropIndex command/);
  });

  it('rejects operation with missing id', () => {
    const json = [
      {
        label: 'test',
        operationClass: 'additive',
        precheck: [],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid migration operation/);
  });

  it('rejects operation with invalid operationClass', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'invalid',
        precheck: [],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid migration operation/);
  });

  it('rejects check with missing description', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            source: { kind: 'listIndexes', collection: 'users' },
            filter: { kind: 'field', field: 'x', op: '$eq', value: 1 },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid migration check/);
  });

  it('rejects field filter with missing field', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'listIndexes', collection: 'users' },
            filter: { kind: 'field', op: '$eq', value: 1 },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid field filter/);
  });

  it('rejects exists filter with missing exists flag', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'listIndexes', collection: 'users' },
            filter: { kind: 'exists', field: 'x' },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid exists filter/);
  });

  it('rejects listIndexes with missing collection', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'listIndexes' },
            filter: { kind: 'field', field: 'x', op: '$eq', value: 1 },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid listIndexes command/);
  });

  it('preserves createIndex options through round-trip', () => {
    const pfe = { active: { $eq: true } };
    const op: MongoMigrationPlanOperation = {
      id: 'test',
      label: 'test',
      operationClass: 'additive',
      precheck: [],
      execute: [
        {
          description: 'create index',
          command: new CreateIndexCommand('users', [{ field: 'status', direction: 1 }], {
            unique: true,
            sparse: true,
            expireAfterSeconds: 3600,
            partialFilterExpression: pfe,
            name: 'status_1',
          }),
        },
      ],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const cmd = asDdlOp(deserialized[0]!).execute[0]!.command as CreateIndexCommand;
    expect(cmd.unique).toBe(true);
    expect(cmd.sparse).toBe(true);
    expect(cmd.expireAfterSeconds).toBe(3600);
    expect(cmd.partialFilterExpression).toEqual(pfe);
    expect(cmd.name).toBe('status_1');
  });

  it('round-trips createIndex with M2 options', () => {
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
            wildcardProjection: { name: 1, email: 1 },
          }),
        },
      ],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const cmd = asDdlOp(deserialized[0]!).execute[0]!.command as CreateIndexCommand;
    expect(cmd.weights).toEqual({ bio: 10 });
    expect(cmd.default_language).toBe('english');
    expect(cmd.language_override).toBe('lang');
    expect(cmd.collation).toEqual({ locale: 'en', strength: 2 });
    expect(cmd.wildcardProjection).toEqual({ name: 1, email: 1 });
  });

  // TML-2486: planner → runner ops are passed in-process (no JSON round-trip)
  // between `MongoMigrationPlanner.plan()` and `MongoMigrationRunner.execute()`.
  // The deserializer's arktype schemas treat `{ capped?: 'boolean' }` as
  // "key may be absent, but if present must be boolean"; the bare op IRs
  // assign every optional field on every instance, so deserialization fails
  // unless the boundary strips undefined keys.
  it('deserialises an in-memory createCollection op without JSON round-trip', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'coll.users.create',
      label: 'Create collection users',
      operationClass: 'additive',
      precheck: [
        {
          description: 'collection does not exist',
          source: new ListCollectionsCommand(),
          filter: MongoFieldFilter.eq('name', 'users'),
          expect: 'notExists',
        },
      ],
      execute: [
        {
          description: 'create users collection',
          command: new CreateCollectionCommand('users'),
        },
      ],
      postcheck: [],
    };
    const [deserialized] = deserializeMongoOps([op]);
    const cmd = asDdlOp(deserialized!).execute[0]!.command as CreateCollectionCommand;
    expect(cmd.kind).toBe('createCollection');
    expect(cmd.collection).toBe('users');
    expect(cmd.capped).toBeUndefined();
    expect(cmd.validator).toBeUndefined();
  });

  it('round-trips createCollection command', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'coll.events.create',
      label: 'Create collection events',
      operationClass: 'additive',
      precheck: [
        {
          description: 'collection does not exist',
          source: new ListCollectionsCommand(),
          filter: MongoFieldFilter.eq('name', 'events'),
          expect: 'notExists',
        },
      ],
      execute: [
        {
          description: 'create events collection',
          command: new CreateCollectionCommand('events', {
            capped: true,
            size: 1048576,
            max: 1000,
            validator: { $jsonSchema: { bsonType: 'object' } },
            validationLevel: 'strict',
            validationAction: 'error',
          }),
        },
      ],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const cmd = asDdlOp(deserialized[0]!).execute[0]!.command as CreateCollectionCommand;
    expect(cmd.kind).toBe('createCollection');
    expect(cmd.collection).toBe('events');
    expect(cmd.capped).toBe(true);
    expect(cmd.size).toBe(1048576);
    expect(cmd.max).toBe(1000);
    expect(cmd.validator).toEqual({ $jsonSchema: { bsonType: 'object' } });
    expect(cmd.validationLevel).toBe('strict');
    expect(cmd.validationAction).toBe('error');
  });

  it('round-trips dropCollection command', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'coll.events.drop',
      label: 'Drop collection events',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: 'drop events collection',
          command: new DropCollectionCommand('events'),
        },
      ],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const cmd = asDdlOp(deserialized[0]!).execute[0]!.command as DropCollectionCommand;
    expect(cmd.kind).toBe('dropCollection');
    expect(cmd.collection).toBe('events');
  });

  it('round-trips collMod command', () => {
    const op: MongoMigrationPlanOperation = {
      id: 'validator.users.update',
      label: 'Update validator on users',
      operationClass: 'destructive',
      precheck: [],
      execute: [
        {
          description: 'update validator on users',
          command: new CollModCommand('users', {
            validator: { $jsonSchema: { bsonType: 'object' } },
            validationLevel: 'strict',
            validationAction: 'error',
            changeStreamPreAndPostImages: { enabled: true },
          }),
        },
      ],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const cmd = asDdlOp(deserialized[0]!).execute[0]!.command as CollModCommand;
    expect(cmd.kind).toBe('collMod');
    expect(cmd.collection).toBe('users');
    expect(cmd.validator).toEqual({ $jsonSchema: { bsonType: 'object' } });
    expect(cmd.validationLevel).toBe('strict');
    expect(cmd.validationAction).toBe('error');
    expect(cmd.changeStreamPreAndPostImages).toEqual({ enabled: true });
  });

  it('rejects and filter with non-array exprs', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'listIndexes', collection: 'users' },
            filter: { kind: 'and', exprs: 'not-array' },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid and filter/);
  });

  it('rejects or filter with non-array exprs', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'listIndexes', collection: 'users' },
            filter: { kind: 'or', exprs: 'not-array' },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid or filter/);
  });

  it('rejects not filter with missing expr', () => {
    const json = [
      {
        id: 'test',
        label: 'test',
        operationClass: 'additive',
        precheck: [
          {
            description: 'test',
            source: { kind: 'listIndexes', collection: 'users' },
            filter: { kind: 'not' },
            expect: 'exists',
          },
        ],
        execute: [],
        postcheck: [],
      },
    ];
    expect(() => deserializeMongoOps(json)).toThrow(/Invalid not filter/);
  });

  it('round-trips createCollection with M2 options', () => {
    const timeseries = { timeField: 'ts', metaField: 'meta', granularity: 'hours' as const };
    const collation = { locale: 'en', strength: 2 };
    const changeStreamPreAndPostImages = { enabled: true };
    const clusteredIndex = { key: { _id: 1 }, unique: true, name: 'clustered' };
    const op: MongoMigrationPlanOperation = {
      id: 'coll.ts.create',
      label: 'Create time series collection',
      operationClass: 'additive',
      precheck: [
        {
          description: 'collection does not exist',
          source: new ListCollectionsCommand(),
          filter: MongoFieldFilter.eq('name', 'metrics'),
          expect: 'notExists',
        },
      ],
      execute: [
        {
          description: 'create metrics collection',
          command: new CreateCollectionCommand('metrics', {
            timeseries,
            collation,
            changeStreamPreAndPostImages,
            clusteredIndex,
          }),
        },
      ],
      postcheck: [],
    };
    const deserialized = deserializeMongoOps(JSON.parse(serializeMongoOps([op])) as unknown[]);
    const cmd = asDdlOp(deserialized[0]!).execute[0]!.command as CreateCollectionCommand;
    expect(cmd.kind).toBe('createCollection');
    expect(cmd.collection).toBe('metrics');
    expect(cmd.timeseries).toEqual(timeseries);
    expect(cmd.collation).toEqual(collation);
    expect(cmd.changeStreamPreAndPostImages).toEqual(changeStreamPreAndPostImages);
    expect(cmd.clusteredIndex).toEqual(clusteredIndex);
  });
});
