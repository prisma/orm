import {
  AggregateCommand,
  MongoAddFieldsStage,
  MongoAggFieldRef,
  MongoAggLiteral,
  MongoFieldFilter,
  MongoLimitStage,
  MongoLookupStage,
  MongoMatchStage,
  MongoMergeStage,
  MongoProjectStage,
  MongoSortStage,
  RawAggregateCommand,
  RawDeleteManyCommand,
  RawDeleteOneCommand,
  RawFindOneAndDeleteCommand,
  RawFindOneAndUpdateCommand,
  RawInsertManyCommand,
  RawInsertOneCommand,
  RawUpdateManyCommand,
  RawUpdateOneCommand,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import {
  deserializeDmlCommand,
  deserializeMongoQueryPlan,
  deserializePipelineStage,
} from '../src/core/migrations/mongo-ops-serializer';

describe('deserializeDmlCommand', () => {
  describe('raw commands', () => {
    it('round-trips rawInsertOne', () => {
      const cmd = new RawInsertOneCommand('users', { name: 'Alice', age: 30 });
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawInsertOne');
      expect(result).toMatchObject({ collection: 'users', document: { name: 'Alice', age: 30 } });
    });

    it('preserves prototype-bound payload values through in-process deserialize (no JSON round-trip)', () => {
      // Simulate a BSON-style wrapper (e.g. ObjectId) embedded in a payload:
      // it's a class instance whose enumerable own properties carry no
      // `undefined` values, so stripUndefinedDeep must leave it untouched.
      class FakeObjectId {
        readonly _bsontype = 'ObjectId';
        constructor(public readonly id: string) {}
        toString(): string {
          return `ObjectId(${this.id})`;
        }
      }
      const oid = new FakeObjectId('507f1f77bcf86cd799439011');
      const cmd = new RawInsertOneCommand('users', { _id: oid, name: 'Alice' });
      // Pass the class instance directly — no JSON.stringify boundary.
      const result = deserializeDmlCommand(cmd) as RawInsertOneCommand;
      expect(result.kind).toBe('rawInsertOne');
      const doc = result.document as { _id: unknown; name: string };
      expect(doc._id).toBe(oid);
      expect(doc._id).toBeInstanceOf(FakeObjectId);
      expect((doc._id as FakeObjectId).toString()).toBe('ObjectId(507f1f77bcf86cd799439011)');
    });

    it('round-trips rawInsertMany', () => {
      const cmd = new RawInsertManyCommand('users', [{ name: 'Alice' }, { name: 'Bob' }]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawInsertMany');
      expect(result).toMatchObject({
        collection: 'users',
        documents: [{ name: 'Alice' }, { name: 'Bob' }],
      });
    });

    it('round-trips rawUpdateOne', () => {
      const cmd = new RawUpdateOneCommand('users', { _id: '1' }, { $set: { name: 'Bob' } });
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawUpdateOne');
      expect(result).toMatchObject({
        collection: 'users',
        filter: { _id: '1' },
        update: { $set: { name: 'Bob' } },
      });
    });

    it('round-trips rawUpdateMany', () => {
      const cmd = new RawUpdateManyCommand(
        'users',
        { status: { $exists: false } },
        { $set: { status: 'active' } },
      );
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawUpdateMany');
      expect(result).toMatchObject({
        collection: 'users',
        filter: { status: { $exists: false } },
        update: { $set: { status: 'active' } },
      });
    });

    it('round-trips rawUpdateMany with pipeline update', () => {
      const cmd = new RawUpdateManyCommand('users', {}, [
        { $set: { fullName: { $concat: ['$first', ' ', '$last'] } } },
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawUpdateMany');
      expect(result).toMatchObject({
        collection: 'users',
        filter: {},
        update: [{ $set: { fullName: { $concat: ['$first', ' ', '$last'] } } }],
      });
    });

    it('round-trips rawDeleteOne', () => {
      const cmd = new RawDeleteOneCommand('users', { _id: '1' });
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawDeleteOne');
      expect(result).toMatchObject({ collection: 'users', filter: { _id: '1' } });
    });

    it('round-trips rawDeleteMany', () => {
      const cmd = new RawDeleteManyCommand('users', { status: 'inactive' });
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawDeleteMany');
      expect(result).toMatchObject({ collection: 'users', filter: { status: 'inactive' } });
    });

    it('round-trips rawAggregate', () => {
      const cmd = new RawAggregateCommand('users', [
        { $match: { status: 'active' } },
        { $group: { _id: '$role', count: { $sum: 1 } } },
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawAggregate');
      expect(result).toMatchObject({
        collection: 'users',
        pipeline: [
          { $match: { status: 'active' } },
          { $group: { _id: '$role', count: { $sum: 1 } } },
        ],
      });
    });

    it('round-trips rawFindOneAndUpdate', () => {
      const cmd = new RawFindOneAndUpdateCommand(
        'users',
        { _id: '1' },
        { $set: { name: 'Alice' } },
        true,
      );
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawFindOneAndUpdate');
      expect(result).toMatchObject({
        collection: 'users',
        filter: { _id: '1' },
        update: { $set: { name: 'Alice' } },
        upsert: true,
      });
    });

    it('round-trips rawFindOneAndDelete', () => {
      const cmd = new RawFindOneAndDeleteCommand('users', { _id: '1' });
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('rawFindOneAndDelete');
      expect(result).toMatchObject({ collection: 'users', filter: { _id: '1' } });
    });
  });

  describe('typed aggregate command', () => {
    it('round-trips aggregate with match and limit stages', () => {
      const cmd = new AggregateCommand('users', [
        new MongoMatchStage(MongoFieldFilter.eq('status', 'active')),
        new MongoLimitStage(10),
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json);
      expect(result.kind).toBe('aggregate');
      const agg = result as AggregateCommand;
      expect(agg.collection).toBe('users');
      expect(agg.pipeline).toHaveLength(2);
      expect(agg.pipeline[0]!.kind).toBe('match');
      expect(agg.pipeline[1]!.kind).toBe('limit');
    });

    it('round-trips aggregate with sort stage', () => {
      const cmd = new AggregateCommand('users', [new MongoSortStage({ createdAt: -1, name: 1 })]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      expect(result.pipeline).toHaveLength(1);
      expect(result.pipeline[0]!.kind).toBe('sort');
      const sort = result.pipeline[0] as MongoSortStage;
      expect(sort.sort).toEqual({ createdAt: -1, name: 1 });
    });

    it('round-trips aggregate with project stage', () => {
      const cmd = new AggregateCommand('users', [
        new MongoProjectStage({ name: 1, email: 1, _id: 0 }),
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      expect(result.pipeline[0]!.kind).toBe('project');
      const proj = result.pipeline[0] as MongoProjectStage;
      expect(proj.projection).toEqual({ name: 1, email: 1, _id: 0 });
    });

    it('round-trips aggregate with addFields stage', () => {
      const cmd = new AggregateCommand('users', [
        new MongoAddFieldsStage({ fullName: new MongoAggFieldRef('$name') }),
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      expect(result.pipeline[0]!.kind).toBe('addFields');
    });

    it('round-trips aggregate with lookup stage (equality)', () => {
      const cmd = new AggregateCommand('orders', [
        new MongoLookupStage({
          from: 'users',
          localField: 'userId',
          foreignField: '_id',
          as: 'user',
        }),
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      expect(result.pipeline[0]!.kind).toBe('lookup');
      const lookup = result.pipeline[0] as MongoLookupStage;
      expect(lookup.from).toBe('users');
      expect(lookup.localField).toBe('userId');
      expect(lookup.foreignField).toBe('_id');
      expect(lookup.as).toBe('user');
    });

    it('round-trips aggregate with lookup stage (pipeline)', () => {
      const cmd = new AggregateCommand('orders', [
        new MongoLookupStage({
          from: 'products',
          as: 'items',
          pipeline: [new MongoMatchStage(MongoFieldFilter.eq('active', true))],
        }),
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      const lookup = result.pipeline[0] as MongoLookupStage;
      expect(lookup.kind).toBe('lookup');
      expect(lookup.from).toBe('products');
      expect(lookup.as).toBe('items');
      expect(lookup.pipeline).toHaveLength(1);
      expect(lookup.pipeline![0]!.kind).toBe('match');
    });

    it('round-trips aggregate with lookup stage (pipeline + let)', () => {
      const cmd = new AggregateCommand('orders', [
        new MongoLookupStage({
          from: 'products',
          as: 'items',
          pipeline: [new MongoMatchStage(MongoFieldFilter.eq('active', true))],
          let_: {},
        }),
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      const lookup = result.pipeline[0] as MongoLookupStage;
      expect(lookup.let_).toEqual({});
    });

    it('round-trips aggregate with merge stage', () => {
      const cmd = new AggregateCommand('users', [
        new MongoMergeStage({
          into: 'users_archive',
          on: '_id',
          whenMatched: 'replace',
          whenNotMatched: 'insert',
        }),
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      expect(result.pipeline[0]!.kind).toBe('merge');
      const merge = result.pipeline[0] as MongoMergeStage;
      expect(merge.into).toBe('users_archive');
      expect(merge.on).toBe('_id');
      expect(merge.whenMatched).toBe('replace');
      expect(merge.whenNotMatched).toBe('insert');
    });

    it('round-trips merge with whenMatched as update pipeline array', () => {
      const cmd = new AggregateCommand('users', [
        new MongoMergeStage({
          into: 'users_archive',
          whenMatched: [new MongoAddFieldsStage({ merged: MongoAggLiteral.of(true) })],
        }),
      ]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      const merge = result.pipeline[0] as MongoMergeStage;
      expect(Array.isArray(merge.whenMatched)).toBe(true);
      expect((merge.whenMatched as unknown[])[0]).toHaveProperty('kind', 'addFields');
    });

    it('round-trips merge with only into (no whenMatched/whenNotMatched)', () => {
      const cmd = new AggregateCommand('users', [new MongoMergeStage({ into: 'users_archive' })]);
      const json = JSON.parse(JSON.stringify(cmd));
      const result = deserializeDmlCommand(json) as AggregateCommand;
      const merge = result.pipeline[0] as MongoMergeStage;
      expect(merge.into).toBe('users_archive');
      expect(merge.whenMatched).toBeUndefined();
      expect(merge.whenNotMatched).toBeUndefined();
    });
  });

  describe('error cases', () => {
    it('throws for unknown DML command kind', () => {
      expect(() => deserializeDmlCommand({ kind: 'unknownDml', collection: 'x' })).toThrow(
        /Unknown DML command kind/,
      );
    });

    it('throws for rawInsertOne with missing collection', () => {
      expect(() => deserializeDmlCommand({ kind: 'rawInsertOne', document: {} })).toThrow(
        /Invalid rawInsertOne/,
      );
    });

    it('throws for rawUpdateMany with missing filter', () => {
      expect(() =>
        deserializeDmlCommand({
          kind: 'rawUpdateMany',
          collection: 'users',
          update: { $set: { x: 1 } },
        }),
      ).toThrow(/Invalid rawUpdateMany/);
    });
  });
});

describe('deserializePipelineStage', () => {
  it('round-trips match stage', () => {
    const stage = new MongoMatchStage(MongoFieldFilter.eq('status', 'active'));
    const json = JSON.parse(JSON.stringify(stage));
    const result = deserializePipelineStage(json);
    expect(result.kind).toBe('match');
  });

  it('round-trips limit stage', () => {
    const stage = new MongoLimitStage(5);
    const json = JSON.parse(JSON.stringify(stage));
    const result = deserializePipelineStage(json);
    expect(result.kind).toBe('limit');
    expect((result as MongoLimitStage).limit).toBe(5);
  });

  it('round-trips sort stage', () => {
    const stage = new MongoSortStage({ name: 1 });
    const json = JSON.parse(JSON.stringify(stage));
    const result = deserializePipelineStage(json);
    expect(result.kind).toBe('sort');
    expect((result as MongoSortStage).sort).toEqual({ name: 1 });
  });

  it('round-trips project stage', () => {
    const stage = new MongoProjectStage({ name: 1, _id: 0 });
    const json = JSON.parse(JSON.stringify(stage));
    const result = deserializePipelineStage(json);
    expect(result.kind).toBe('project');
    expect((result as MongoProjectStage).projection).toEqual({ name: 1, _id: 0 });
  });

  it('throws for unknown stage kind', () => {
    expect(() => deserializePipelineStage({ kind: 'unknownStage' })).toThrow(
      /Unknown pipeline stage kind/,
    );
  });
});

describe('deserializeMongoQueryPlan', () => {
  it('round-trips a raw command query plan', () => {
    const plan = {
      collection: 'users',
      command: new RawUpdateManyCommand(
        'users',
        { status: { $exists: false } },
        { $set: { status: 'active' } },
      ),
      meta: {
        target: 'mongo',
        storageHash: 'abc',
        lane: 'mongo-raw',
      },
    };
    const json = JSON.parse(JSON.stringify(plan));
    const result = deserializeMongoQueryPlan(json);
    expect(result.collection).toBe('users');
    expect(result.command.kind).toBe('rawUpdateMany');
    expect(result.meta.target).toBe('mongo');
    expect(result.meta.storageHash).toBe('abc');
    expect(result.meta.lane).toBe('mongo-raw');
  });

  it('round-trips an aggregate command query plan', () => {
    const plan = {
      collection: 'users',
      command: new AggregateCommand('users', [
        new MongoMatchStage(MongoFieldFilter.eq('status', 'active')),
        new MongoLimitStage(1),
      ]),
      meta: {
        target: 'mongo',
        storageHash: 'def',
        lane: 'mongo-pipeline',
      },
    };
    const json = JSON.parse(JSON.stringify(plan));
    const result = deserializeMongoQueryPlan(json);
    expect(result.collection).toBe('users');
    expect(result.command.kind).toBe('aggregate');
    const agg = result.command as AggregateCommand;
    expect(agg.pipeline).toHaveLength(2);
  });

  it('preserves targetFamily and profileHash in meta when present', () => {
    const plan = {
      collection: 'users',
      command: new RawInsertOneCommand('users', { name: 'test' }),
      meta: {
        target: 'mongo',
        storageHash: 'abc',
        lane: 'mongo-raw',
        targetFamily: 'mongo',
        profileHash: 'profile',
      },
    };
    const json = JSON.parse(JSON.stringify(plan));
    const result = deserializeMongoQueryPlan(json);
    expect((result.meta as unknown as Record<string, unknown>)['targetFamily']).toBe('mongo');
    expect((result.meta as unknown as Record<string, unknown>)['profileHash']).toBe('profile');
  });

  it('preserves annotations in meta when present', () => {
    const plan = {
      collection: 'users',
      command: new RawInsertOneCommand('users', { name: 'test' }),
      meta: {
        target: 'mongo',
        storageHash: 'abc',
        lane: 'mongo-raw',
        annotations: { intent: 'write' },
      },
    };
    const json = JSON.parse(JSON.stringify(plan));
    const result = deserializeMongoQueryPlan(json);
    expect(result.meta.annotations).toEqual({ intent: 'write' });
  });

  it('throws for missing collection', () => {
    expect(() =>
      deserializeMongoQueryPlan({
        command: { kind: 'rawInsertOne', collection: 'x', document: {} },
        meta: { target: 'mongo', storageHash: 'x', lane: 'raw' },
      }),
    ).toThrow(/Invalid.*query plan/i);
  });
});
