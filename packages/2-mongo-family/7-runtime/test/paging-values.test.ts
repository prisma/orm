import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import { MongoParamRef } from '@internal/mongo-value';
import { describe, expect, it } from 'vitest';
import { assertPagingValues } from '../src/prepared/paging-values';

const bad = () => new MongoParamRef(-1, { name: 'take', codecId: 'mongo/int32@1' });
const good = () => new MongoParamRef(2, { name: 'take', codecId: 'mongo/int32@1' });

function aggregate(...pipeline: Record<string, unknown>[]): MongoLoweredDraft {
  return { kind: 'aggregate', collection: 'users', pipeline };
}

const positions: ReadonlyArray<
  readonly [string, (limit: MongoParamRef) => Record<string, unknown>]
> = [
  ['the pipeline', (limit) => ({ $limit: limit })],
  ['a $skip', (skip) => ({ $skip: skip })],
  [
    'a $lookup sub-pipeline',
    (limit) => ({ $lookup: { from: 'p', as: 'p', pipeline: [{ $limit: limit }] } }),
  ],
  [
    'a $facet sub-pipeline',
    (limit) => ({ $facet: { first: [{ $match: {} }], second: [{ $limit: limit }] } }),
  ],
  [
    'a $unionWith sub-pipeline',
    (limit) => ({ $unionWith: { coll: 'p', pipeline: [{ $skip: limit }] } }),
  ],
  [
    'a $merge whenMatched pipeline',
    (limit) => ({ $merge: { into: 'p', whenMatched: [{ $limit: limit }] } }),
  ],
  [
    'a nested sub-pipeline',
    (limit) => ({
      $lookup: { from: 'p', as: 'p', pipeline: [{ $facet: { inner: [{ $limit: limit }] } }] },
    }),
  ],
];

describe('assertPagingValues', () => {
  it('names the stage and the parameter in the refusal', () => {
    expect(() => assertPagingValues(aggregate({ $skip: bad() }))).toThrow(
      expect.objectContaining({
        code: 'ORM.ARGUMENT_INVALID',
        message: "skip must be a non-negative integer, and parameter 'take' is not",
        meta: { stage: 'skip', name: 'take' },
      }),
    );
  });

  it('names the stage alone for a value with no parameter name', () => {
    expect(() => assertPagingValues(aggregate({ $limit: new MongoParamRef(-2) }))).toThrow(
      expect.objectContaining({
        message: 'limit must be a positive integer',
        meta: { stage: 'limit' },
      }),
    );
  });

  it.each(positions)('refuses a negative value in %s', (_label, stage) => {
    expect(() => assertPagingValues(aggregate(stage(bad())))).toThrow(
      expect.objectContaining({ code: 'ORM.ARGUMENT_INVALID' }),
    );
  });

  it.each(positions)('accepts a non-negative integer in %s', (_label, stage) => {
    expect(() => assertPagingValues(aggregate(stage(good())))).not.toThrow();
  });

  it('leaves the refused value out of the message', () => {
    const secret = new MongoParamRef('s3cret-token', { name: 'take', codecId: 'mongo/string@1' });
    expect(() => assertPagingValues(aggregate({ $limit: secret }))).toThrow(
      expect.objectContaining({ message: expect.not.stringContaining('s3cret-token') }),
    );
  });

  it('refuses a limit of zero and accepts a skip of zero', () => {
    const zero = () => new MongoParamRef(0, { name: 'n', codecId: 'mongo/int32@1' });
    expect(() => assertPagingValues(aggregate({ $limit: zero() }))).toThrow(
      expect.objectContaining({
        message: "limit must be a positive integer, and parameter 'n' is not",
        meta: { stage: 'limit', name: 'n' },
      }),
    );
    expect(() => assertPagingValues(aggregate({ $skip: zero() }))).not.toThrow();
  });

  it('accepts a $lookup with no sub-pipeline and a $merge whose whenMatched is a mode', () => {
    expect(() =>
      assertPagingValues(
        aggregate(
          { $lookup: { from: 'p', localField: 'a', foreignField: 'b', as: 'p' } },
          { $merge: { into: 'p', whenMatched: 'replace' } },
        ),
      ),
    ).not.toThrow();
  });

  it('leaves raw commands and plain numbers alone', () => {
    expect(() =>
      assertPagingValues({
        kind: 'rawAggregate',
        collection: 'users',
        pipeline: [{ $limit: bad() }],
      }),
    ).not.toThrow();
    expect(() => assertPagingValues(aggregate({ $limit: -1 }))).not.toThrow();
  });
});
