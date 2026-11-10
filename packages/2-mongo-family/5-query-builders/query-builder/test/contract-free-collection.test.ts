import {
  AggregateCommand,
  FindOneAndUpdateCommand,
  InsertOneCommand,
  MongoAddFieldsStage,
  MongoAndExpr,
  MongoFieldFilter,
  MongoLimitStage,
  MongoMatchStage,
  MongoSortStage,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import { collection } from '../src/contract-free/collection';
import { expr, fn } from '../src/exports/index';

type TestShape = {
  readonly _id: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly space: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly storageHash: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
  readonly type: { readonly codecId: 'mongo/string@1'; readonly nullable: false };
};

const COLL = 'test_collection';
const col = collection<TestShape>(COLL);

describe('collection() — aggregate chain', () => {
  it('aggregate().build() produces AggregateCommand with correct collection and empty pipeline', () => {
    const cmd = col.aggregate().build();
    expect(cmd).toBeInstanceOf(AggregateCommand);
    expect(cmd.collection).toBe(COLL);
    expect(cmd.pipeline).toHaveLength(0);
  });

  it('aggregate().match().limit() produces $match then $limit stages', () => {
    const cmd = col
      .aggregate()
      .match((f) => f._id.eq('x'))
      .limit(1)
      .build();
    expect(cmd.pipeline).toHaveLength(2);
    expect(cmd.pipeline[0]).toBeInstanceOf(MongoMatchStage);
    expect(cmd.pipeline[1]).toBeInstanceOf(MongoLimitStage);
    expect((cmd.pipeline[1] as MongoLimitStage).limit).toBe(1);
  });

  it('aggregate().match().sort() produces $match then $sort stages', () => {
    const cmd = col
      .aggregate()
      .match((f) => f.type.eq('ledger'))
      .sort({ _id: 1 })
      .build();
    expect(cmd.pipeline).toHaveLength(2);
    expect(cmd.pipeline[1]).toBeInstanceOf(MongoSortStage);
    expect((cmd.pipeline[1] as MongoSortStage).sort).toEqual({ _id: 1 });
  });

  it('aggregate().match().match().limit() — depth-≥2 chain with correct stage order (F21 self-litmus)', () => {
    const cmd = col
      .aggregate()
      .match((f) => f._id.eq('space-a'))
      .match((f) => f.space.eq('space-a'))
      .limit(1)
      .build();
    expect(cmd).toBeInstanceOf(AggregateCommand);
    expect(cmd.pipeline).toHaveLength(3);
    expect(cmd.pipeline[0]).toBeInstanceOf(MongoMatchStage);
    expect(cmd.pipeline[1]).toBeInstanceOf(MongoMatchStage);
    expect(cmd.pipeline[2]).toBeInstanceOf(MongoLimitStage);
    const filter0 = (cmd.pipeline[0] as MongoMatchStage).filter;
    const filter1 = (cmd.pipeline[1] as MongoMatchStage).filter;
    expect(filter0).toBeInstanceOf(MongoFieldFilter);
    expect((filter0 as MongoFieldFilter).field).toBe('_id');
    expect(filter1).toBeInstanceOf(MongoFieldFilter);
    expect((filter1 as MongoFieldFilter).field).toBe('space');
  });

  it('aggregate() with .type() filter uses MongoFieldFilter with $type op', () => {
    const cmd = col
      .aggregate()
      .match((f) => f._id.type('string'))
      .build();
    const stage = cmd.pipeline[0] as MongoMatchStage;
    const filter = stage.filter as MongoFieldFilter;
    expect(filter).toBeInstanceOf(MongoFieldFilter);
    expect(filter.field).toBe('_id');
    expect(filter.op).toBe('$type');
  });

  it('aggregate() with expr(fn.eq(...)) uses MongoExprFilter wrapper', () => {
    const cmd = col
      .aggregate()
      .match((f) => expr(fn.eq(f._id, f.space)))
      .build();
    const stage = cmd.pipeline[0] as MongoMatchStage;
    expect(stage.filter.kind).toBe('expr');
  });
});

describe('collection() — insertOne', () => {
  it('insertOne returns InsertOneCommand with the document and collection name', () => {
    const doc = { _id: 'space-x', space: 'space-x', storageHash: 'h1' };
    const cmd = col.insertOne(doc);
    expect(cmd).toBeInstanceOf(InsertOneCommand);
    expect(cmd.collection).toBe(COLL);
    expect(cmd.document).toMatchObject(doc);
  });

  it('insertOne does not require the chain to go through match first', () => {
    const cmd = col.insertOne({ _id: 'a' });
    expect(cmd).toBeInstanceOf(InsertOneCommand);
  });
});

describe('collection() — match().findOneAndUpdate() (CAS shape)', () => {
  it('single match folds the filter directly (no redundant $and wrapper)', () => {
    const cmd = col
      .match((f) => f._id.eq('x'))
      .findOneAndUpdate((f) => [f.storageHash.set('h2')], { upsert: false });
    expect(cmd).toBeInstanceOf(FindOneAndUpdateCommand);
    expect(cmd.collection).toBe(COLL);
    expect(cmd.upsert).toBe(false);
    expect(cmd.filter).toBeInstanceOf(MongoFieldFilter);
  });

  it('two match() calls AND-fold into a single MongoAndExpr filter without MongoAndExpr.of at the call site', () => {
    const cmd = col
      .match((f) => f._id.eq('space-a'))
      .match((f) => f.storageHash.eq('h0'))
      .findOneAndUpdate((f) => [f.storageHash.set('h1')], { upsert: false });
    expect(cmd).toBeInstanceOf(FindOneAndUpdateCommand);
    expect(cmd.filter).toBeInstanceOf(MongoAndExpr);
    const andFilter = cmd.filter as MongoAndExpr;
    expect(andFilter.exprs).toHaveLength(2);
  });

  it('three match() calls AND-fold into a single MongoAndExpr with three members', () => {
    const cmd = col
      .match((f) => f._id.eq('space-a'))
      .match((f) => f.space.eq('space-a'))
      .match((f) => f.storageHash.eq('h0'))
      .findOneAndUpdate((f) => [f.storageHash.set('h1')], { upsert: false });
    const andFilter = cmd.filter as MongoAndExpr;
    expect(andFilter).toBeInstanceOf(MongoAndExpr);
    expect(andFilter.exprs).toHaveLength(3);
  });

  it('findOneAndUpdate update callback with f.stage.set produces a pipeline update array', () => {
    const updatedAt = new Date('2026-01-01T00:00:00.000Z');
    const cmd = col
      .match((f) => f._id.eq('space-a'))
      .match((f) => f.storageHash.eq('h0'))
      .findOneAndUpdate(
        (f) => [
          f.stage.set({ storageHash: f.storageHash.node, updatedAt: fn.literal(updatedAt).node }),
        ],
        { upsert: false },
      );
    expect(Array.isArray(cmd.update)).toBe(true);
    const stages = cmd.update as MongoAddFieldsStage[];
    expect(stages[0]).toBeInstanceOf(MongoAddFieldsStage);
  });

  it('findOneAndUpdate defaults returnDocument to "after" and upsert to false', () => {
    const cmd = col.match((f) => f._id.eq('x')).findOneAndUpdate((f) => [f.storageHash.set('h1')]);
    expect(cmd.upsert).toBe(false);
    expect(cmd.returnDocument).toBe('after');
  });

  it('findOneAndUpdate respects upsert: true option', () => {
    const cmd = col
      .match((f) => f._id.eq('x'))
      .findOneAndUpdate((f) => [f.storageHash.set('h1')], { upsert: true });
    expect(cmd.upsert).toBe(true);
  });
});
