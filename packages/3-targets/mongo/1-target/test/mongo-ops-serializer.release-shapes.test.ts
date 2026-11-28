import {
  MongoMergeStage,
  RawFindOneAndDeleteCommand,
  RawFindOneAndUpdateCommand,
} from '@internal/mongo-query-ast/execution';
import { describe, expect, it } from 'vitest';
import {
  deserializeDmlCommand,
  deserializeMongoQueryPlan,
  deserializePipelineStage,
} from '../src/core/migrations/mongo-ops-serializer';

const meta = { target: 'mongo', storageHash: 'sha256:abc', lane: 'mongo-raw' };

function plan(extra: Record<string, unknown>): Record<string, unknown> {
  return {
    collection: 'users',
    command: { kind: 'rawAggregate', collection: 'users', pipeline: [{ $match: {} }] },
    meta,
    ...extra,
  };
}

describe('a query plan in a data transform', () => {
  it('reads the result shape the query builder writes for a pipeline on a model', () => {
    const resultShape = {
      kind: 'document',
      fields: {
        name: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        tags: {
          kind: 'array',
          nullable: false,
          element: { kind: 'leaf', codecId: 'mongo/string@1', nullable: false },
        },
      },
    };
    expect(deserializeMongoQueryPlan(plan({ resultShape }))).toMatchObject({
      collection: 'users',
      meta,
    });
  });

  it('reads plan meta with entries no reader acts on, such as the parameter descriptors a hand-written plan carries', () => {
    expect(
      deserializeMongoQueryPlan(plan({ meta: { ...meta, paramDescriptors: [] } })).meta,
    ).toEqual(meta);
  });

  it('refuses plan meta whose entries the reader acts on are malformed', () => {
    expect(() => deserializeMongoQueryPlan(plan({ meta: { ...meta, lane: 1 } }))).toThrow(
      /meta\.lane must be a string/,
    );
  });
});

describe('a find-and-modify command', () => {
  it('keeps the sort and the document to return of rawFindOneAndUpdate', () => {
    const cmd = new RawFindOneAndUpdateCommand(
      'users',
      { status: 'pending' },
      { $set: { status: 'done' } },
      false,
      { createdAt: 1 },
      'after',
    );
    expect(deserializeDmlCommand(JSON.parse(JSON.stringify(cmd)))).toMatchObject({
      sort: { createdAt: 1 },
      returnDocument: 'after',
    });
  });

  it('keeps the sort of rawFindOneAndDelete', () => {
    const cmd = new RawFindOneAndDeleteCommand('users', { status: 'pending' }, { createdAt: -1 });
    expect(deserializeDmlCommand(JSON.parse(JSON.stringify(cmd)))).toMatchObject({
      sort: { createdAt: -1 },
    });
  });
});

describe('a $merge stage', () => {
  const merge = new MongoMergeStage({
    into: { db: 'archive', coll: 'users' },
    on: ['_id'],
    whenMatched: 'replace',
    whenNotMatched: 'insert',
  });

  it('reads every field it defines', () => {
    expect(deserializePipelineStage(JSON.parse(JSON.stringify(merge)))).toEqual(merge);
  });

  it.each([
    ['the stage', (json: Record<string, unknown>) => json, 'unexpected must be removed'],
    [
      'its target collection',
      (json: Record<string, unknown>) => json['into'] as Record<string, unknown>,
      'into.unexpected must be removed',
    ],
  ])('refuses a key %s does not define', (_, placeOf, reason) => {
    const json = JSON.parse(JSON.stringify(merge));
    placeOf(json)['unexpected'] = true;
    expect(() => deserializePipelineStage(json)).toThrow(reason);
  });

  it('refuses a target collection that is neither a name nor a database and collection', () => {
    const json = { ...JSON.parse(JSON.stringify(merge)), into: 3 };
    expect(() => deserializePipelineStage(json)).toThrow(/into/);
  });
});
