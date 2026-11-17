import { CreateCollectionCommand, CreateIndexCommand } from '@internal/mongo-query-ast/control';
import { describe, expect, it } from 'vitest';
import { collection } from '../src/contract-free/collection';

const COLL = 'my_collection';
const col = collection(COLL);

describe('collection().createCollection()', () => {
  it('returns a frozen CreateCollectionCommand with the collection name', () => {
    const cmd = col.createCollection();
    expect(cmd).toBeInstanceOf(CreateCollectionCommand);
    expect(cmd.collection).toBe(COLL);
    expect(Object.isFrozen(cmd)).toBe(true);
  });

  it('matches directly-constructed CreateCollectionCommand with no options', () => {
    const cmd = col.createCollection();
    const direct = new CreateCollectionCommand(COLL);
    expect(cmd).toEqual(direct);
  });

  it('passes validator options through to the command node', () => {
    const opts = {
      validator: { $jsonSchema: { required: ['email'] } },
      validationLevel: 'strict' as const,
      validationAction: 'error' as const,
    };
    const cmd = col.createCollection(opts);
    expect(cmd).toEqual(new CreateCollectionCommand(COLL, opts));
    expect(cmd.validator).toEqual(opts.validator);
    expect(cmd.validationLevel).toBe('strict');
    expect(cmd.validationAction).toBe('error');
  });

  it('passes capped/size/max options through', () => {
    const opts = { capped: true, size: 1_000_000, max: 5_000 };
    const cmd = col.createCollection(opts);
    expect(cmd).toEqual(new CreateCollectionCommand(COLL, opts));
    expect(cmd.capped).toBe(true);
    expect(cmd.size).toBe(1_000_000);
    expect(cmd.max).toBe(5_000);
  });

  it('passes timeseries options through', () => {
    const opts = {
      timeseries: { timeField: 'ts', metaField: 'src', granularity: 'minutes' as const },
    };
    const cmd = col.createCollection(opts);
    expect(cmd).toEqual(new CreateCollectionCommand(COLL, opts));
    expect(cmd.timeseries).toEqual(opts.timeseries);
  });

  it('passes clusteredIndex and collation through', () => {
    const opts = {
      clusteredIndex: { key: { _id: 1 } as Record<string, number>, unique: true, name: 'clust' },
      collation: { locale: 'en' },
    };
    const cmd = col.createCollection(opts);
    expect(cmd).toEqual(new CreateCollectionCommand(COLL, opts));
  });
});

describe('collection().createIndex()', () => {
  const keys = [{ field: 'email', direction: 1 as const }];

  it('returns a frozen CreateIndexCommand with the collection name and keys', () => {
    const cmd = col.createIndex(keys);
    expect(cmd).toBeInstanceOf(CreateIndexCommand);
    expect(cmd.collection).toBe(COLL);
    expect(cmd.keys).toEqual(keys);
    expect(Object.isFrozen(cmd)).toBe(true);
  });

  it('matches directly-constructed CreateIndexCommand with no options', () => {
    const cmd = col.createIndex(keys);
    const direct = new CreateIndexCommand(COLL, keys);
    expect(cmd).toEqual(direct);
  });

  it('passes unique and name options through', () => {
    const name = 'email_1';
    const opts = { unique: true, name };
    const cmd = col.createIndex(keys, opts);
    expect(cmd).toEqual(new CreateIndexCommand(COLL, keys, opts));
    expect(cmd.unique).toBe(true);
    expect(cmd.name).toBe(name);
  });

  it('passes sparse/expireAfterSeconds/collation options through', () => {
    const opts = { sparse: true, expireAfterSeconds: 3600, collation: { locale: 'en' } };
    const cmd = col.createIndex(keys, opts);
    expect(cmd).toEqual(new CreateIndexCommand(COLL, keys, opts));
    expect(cmd.sparse).toBe(true);
    expect(cmd.expireAfterSeconds).toBe(3600);
    expect(cmd.collation).toEqual({ locale: 'en' });
  });

  it('passes text-index options through (weights, default_language, language_override)', () => {
    const textKeys = [{ field: 'body', direction: 'text' as const }];
    const opts = { weights: { body: 10 }, default_language: 'english', language_override: 'lang' };
    const cmd = col.createIndex(textKeys, opts);
    expect(cmd).toEqual(new CreateIndexCommand(COLL, textKeys, opts));
    expect(cmd.weights).toEqual({ body: 10 });
    expect(cmd.default_language).toBe('english');
    expect(cmd.language_override).toBe('lang');
  });

  it('passes wildcardProjection through', () => {
    const opts = { wildcardProjection: { a: 1, b: 0 } as Record<string, 0 | 1> };
    const cmd = col.createIndex(keys, opts);
    expect(cmd).toEqual(new CreateIndexCommand(COLL, keys, opts));
    expect(cmd.wildcardProjection).toEqual({ a: 1, b: 0 });
  });

  it('passes partialFilterExpression through', () => {
    const opts = { partialFilterExpression: { status: { $eq: 'active' } } };
    const cmd = col.createIndex(keys, opts);
    expect(cmd).toEqual(new CreateIndexCommand(COLL, keys, opts));
    expect(cmd.partialFilterExpression).toEqual(opts.partialFilterExpression);
  });

  it('compound keys produce the correct command', () => {
    const compoundKeys = [
      { field: 'email', direction: 1 as const },
      { field: 'name', direction: -1 as const },
    ];
    const cmd = col.createIndex(compoundKeys);
    expect(cmd).toEqual(new CreateIndexCommand(COLL, compoundKeys));
    expect(cmd.keys).toEqual(compoundKeys);
  });
});
