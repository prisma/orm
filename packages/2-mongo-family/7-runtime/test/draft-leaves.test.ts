import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import { MongoParamRef, MongoPreparedParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { flattenMongoDraftLeaves, mapMongoDraftLeaves } from '../src/draft-leaves';
import { flattenMongoParamRefs } from '../src/param-ref-mutator';

const email = new MongoPreparedParamRef('email', 'mongo/string@1', false);
const take = new MongoPreparedParamRef('take', 'mongo/int32@1', false);
const status = new MongoParamRef('active', { codecId: 'mongo/string@1' });

const aggregate: MongoLoweredDraft = {
  kind: 'aggregate',
  collection: 'users',
  pipeline: [
    { $match: { email: { $eq: email }, status: { $eq: status } } },
    { $lookup: { from: 'posts', as: 'posts', pipeline: [{ $limit: take }] } },
    { $limit: take },
  ],
};

describe('flattenMongoDraftLeaves', () => {
  it('yields parameters and placeholders in walk order, once per position', () => {
    expect([...flattenMongoDraftLeaves(aggregate)]).toEqual([email, status, take, take]);
  });

  it('yields a placeholder inside a raw command', () => {
    const draft: MongoLoweredDraft = {
      kind: 'rawUpdateOne',
      collection: 'users',
      filter: { email },
      update: [{ $set: { seen: true } }],
    };
    expect([...flattenMongoDraftLeaves(draft)]).toEqual([email]);
  });
});

describe('flattenMongoParamRefs', () => {
  it('skips placeholders', () => {
    expect([...flattenMongoParamRefs(aggregate)]).toEqual([status]);
  });
});

describe('mapMongoDraftLeaves', () => {
  it('replaces each leaf with the mapped value and keeps the rest of the draft', () => {
    const bound = new MongoParamRef(20, { name: 'take', codecId: 'mongo/int32@1' });
    const mapped = mapMongoDraftLeaves(aggregate, (leaf) => (leaf === take ? bound : leaf));
    expect(mapped).toEqual({
      kind: 'aggregate',
      collection: 'users',
      pipeline: [
        { $match: { email: { $eq: email }, status: { $eq: status } } },
        { $lookup: { from: 'posts', as: 'posts', pipeline: [{ $limit: bound }] } },
        { $limit: bound },
      ],
    });
  });

  it('keeps the fields of each draft kind', () => {
    const draft: MongoLoweredDraft = {
      kind: 'findOneAndUpdate',
      collection: 'users',
      filter: { email },
      update: { $set: { status } },
      upsert: true,
      sort: { createdAt: -1 },
      returnDocument: 'after',
    };
    expect(mapMongoDraftLeaves(draft, (leaf) => leaf)).toEqual(draft);
  });
});
