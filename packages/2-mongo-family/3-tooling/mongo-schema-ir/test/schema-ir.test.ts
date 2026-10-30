import { indexLookupKey } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import { MongoSchemaCollection } from '../src/schema-collection';
import { MongoSchemaCollectionOptions } from '../src/schema-collection-options';
import { MongoSchemaIndex } from '../src/schema-index';
import { MongoSchemaIR } from '../src/schema-ir';
import { MongoSchemaValidator } from '../src/schema-validator';
import type { MongoSchemaVisitor } from '../src/visitor';

describe('MongoSchemaIndex', () => {
  it('constructs with required fields', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(index.nodeKind).toBe('index');
    expect(index.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(index.unique).toBe(false);
    expect(index.sparse).toBeUndefined();
    expect(index.expireAfterSeconds).toBeUndefined();
    expect(index.partialFilterExpression).toBeUndefined();
  });

  it('constructs with all options', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      unique: true,
      sparse: true,
      expireAfterSeconds: 3600,
      partialFilterExpression: { active: { $eq: true } },
    });
    expect(index.unique).toBe(true);
    expect(index.sparse).toBe(true);
    expect(index.expireAfterSeconds).toBe(3600);
    expect(index.partialFilterExpression).toEqual({ active: { $eq: true } });
  });

  it('constructs with M2 index options', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'bio', direction: 'text' }],
      weights: { bio: 10 },
      default_language: 'english',
      language_override: 'lang',
      collation: { locale: 'en', strength: 2 },
    });
    expect(index.weights).toEqual({ bio: 10 });
    expect(index.default_language).toBe('english');
    expect(index.language_override).toBe('lang');
    expect(index.collation).toEqual({ locale: 'en', strength: 2 });
  });

  it('constructs with wildcardProjection', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: '$**', direction: 1 }],
      wildcardProjection: { name: 1, email: 1 },
    });
    expect(index.wildcardProjection).toEqual({ name: 1, email: 1 });
  });

  it('is frozen after construction', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(Object.isFrozen(index)).toBe(true);
  });

  it('dispatches via visitor', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    const visitor: MongoSchemaVisitor<string> = {
      schema: () => 'schema',
      collection: () => 'collection',
      index: (node) => `index:${node.keys[0]!.field}`,
      validator: () => 'validator',
      collectionOptions: () => 'collectionOptions',
    };
    expect(index.accept(visitor)).toBe('index:email');
  });
});

describe('MongoSchemaCollection', () => {
  it('constructs with name only', () => {
    const coll = new MongoSchemaCollection({ name: 'users' });
    expect(coll.nodeKind).toBe('collection');
    expect(coll.name).toBe('users');
    expect(coll.indexes).toEqual([]);
  });

  it('constructs with indexes', () => {
    const index = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    const coll = new MongoSchemaCollection({
      name: 'users',
      indexes: [index],
    });
    expect(coll.indexes).toHaveLength(1);
    expect(coll.indexes[0]).toBe(index);
  });

  it('is frozen after construction', () => {
    const coll = new MongoSchemaCollection({ name: 'users' });
    expect(Object.isFrozen(coll)).toBe(true);
  });

  it('dispatches via visitor', () => {
    const coll = new MongoSchemaCollection({ name: 'users' });
    const visitor: MongoSchemaVisitor<string> = {
      schema: () => 'schema',
      collection: (node) => `collection:${node.name}`,
      index: () => 'index',
      validator: () => 'validator',
      collectionOptions: () => 'collectionOptions',
    };
    expect(coll.accept(visitor)).toBe('collection:users');
  });
});

describe('MongoSchemaValidator', () => {
  it('constructs with required fields', () => {
    const v = new MongoSchemaValidator({
      jsonSchema: { bsonType: 'object', properties: { name: { bsonType: 'string' } } },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    expect(v.nodeKind).toBe('validator');
    expect(v.jsonSchema).toEqual({
      bsonType: 'object',
      properties: { name: { bsonType: 'string' } },
    });
    expect(v.validationLevel).toBe('strict');
    expect(v.validationAction).toBe('error');
  });

  it('is frozen after construction', () => {
    const v = new MongoSchemaValidator({
      jsonSchema: {},
      validationLevel: 'moderate',
      validationAction: 'warn',
    });
    expect(Object.isFrozen(v)).toBe(true);
  });

  it('dispatches via visitor', () => {
    const v = new MongoSchemaValidator({
      jsonSchema: {},
      validationLevel: 'strict',
      validationAction: 'error',
    });
    const visitor: MongoSchemaVisitor<string> = {
      schema: () => 'schema',
      collection: () => 'collection',
      index: () => 'index',
      validator: (node) => `validator:${node.validationLevel}`,
      collectionOptions: () => 'collectionOptions',
    };
    expect(v.accept(visitor)).toBe('validator:strict');
  });
});

describe('MongoSchemaCollectionOptions', () => {
  it('constructs with no options', () => {
    const opts = new MongoSchemaCollectionOptions({});
    expect(opts.nodeKind).toBe('collectionOptions');
    expect(opts.capped).toBeUndefined();
    expect(opts.timeseries).toBeUndefined();
    expect(opts.collation).toBeUndefined();
    expect(opts.changeStreamPreAndPostImages).toBeUndefined();
    expect(opts.clusteredIndex).toBeUndefined();
  });

  it('constructs with all options', () => {
    const opts = new MongoSchemaCollectionOptions({
      capped: { size: 1048576, max: 1000 },
      timeseries: { timeField: 'ts', metaField: 'meta', granularity: 'hours' },
      collation: { locale: 'en' },
      changeStreamPreAndPostImages: { enabled: true },
      clusteredIndex: { name: 'myCluster' },
    });
    expect(opts.capped).toEqual({ size: 1048576, max: 1000 });
    expect(opts.timeseries).toEqual({ timeField: 'ts', metaField: 'meta', granularity: 'hours' });
    expect(opts.collation).toEqual({ locale: 'en' });
    expect(opts.changeStreamPreAndPostImages).toEqual({ enabled: true });
    expect(opts.clusteredIndex).toEqual({ name: 'myCluster' });
  });

  it('is frozen after construction', () => {
    const opts = new MongoSchemaCollectionOptions({});
    expect(Object.isFrozen(opts)).toBe(true);
  });

  it('dispatches via visitor', () => {
    const opts = new MongoSchemaCollectionOptions({ capped: { size: 100 } });
    const visitor: MongoSchemaVisitor<string> = {
      schema: () => 'schema',
      collection: () => 'collection',
      index: () => 'index',
      validator: () => 'validator',
      collectionOptions: () => 'collectionOptions',
    };
    expect(opts.accept(visitor)).toBe('collectionOptions');
  });
});

describe('MongoSchemaCollection with validator and options', () => {
  it('constructs with validator and options', () => {
    const validator = new MongoSchemaValidator({
      jsonSchema: { bsonType: 'object' },
      validationLevel: 'strict',
      validationAction: 'error',
    });
    const options = new MongoSchemaCollectionOptions({
      capped: { size: 1048576 },
    });
    const coll = new MongoSchemaCollection({
      name: 'users',
      validator,
      options,
    });
    expect(coll.validator).toBe(validator);
    expect(coll.options).toBe(options);
  });

  it('defaults validator and options to undefined', () => {
    const coll = new MongoSchemaCollection({ name: 'users' });
    expect(coll.validator).toBeUndefined();
    expect(coll.options).toBeUndefined();
  });
});

function sameIndex(a: MongoSchemaIndex, b: MongoSchemaIndex): boolean {
  return indexLookupKey(a) === indexLookupKey(b);
}

describe('indexLookupKey identifies an index', () => {
  it('returns true for identical indexes', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    expect(sameIndex(a, b)).toBe(true);
  });

  it('returns false for different keys', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'name', direction: 1 }],
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different directions', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: -1 }],
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different key order in compound index', () => {
    const a = new MongoSchemaIndex({
      keys: [
        { field: 'a', direction: 1 },
        { field: 'b', direction: 1 },
      ],
    });
    const b = new MongoSchemaIndex({
      keys: [
        { field: 'b', direction: 1 },
        { field: 'a', direction: 1 },
      ],
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different key counts', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'a', direction: 1 }],
    });
    const b = new MongoSchemaIndex({
      keys: [
        { field: 'a', direction: 1 },
        { field: 'b', direction: 1 },
      ],
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different unique', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different sparse', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
      sparse: true,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different expireAfterSeconds', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'ts', direction: 1 }],
      expireAfterSeconds: 3600,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'ts', direction: 1 }],
      expireAfterSeconds: 7200,
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different partialFilterExpression', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: { active: true },
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: { active: false },
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('treats two indexes without partialFilterExpression as equivalent', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'email', direction: 1 }],
    });
    expect(sameIndex(a, b)).toBe(true);
  });

  it('compares nested partialFilterExpression deeply', () => {
    const filter = { $and: [{ status: 'active' }, { age: { $gte: 18 } }] };
    const a = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: filter,
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: { ...filter },
    });
    expect(sameIndex(a, b)).toBe(true);
  });

  it('returns false for different wildcardProjection', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: '$**', direction: 1 }],
      wildcardProjection: { name: 1 },
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: '$**', direction: 1 }],
      wildcardProjection: { email: 1 },
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns true for same wildcardProjection', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: '$**', direction: 1 }],
      wildcardProjection: { name: 1, email: 1 },
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: '$**', direction: 1 }],
      wildcardProjection: { name: 1, email: 1 },
    });
    expect(sameIndex(a, b)).toBe(true);
  });

  it('returns false for different collation', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'name', direction: 1 }],
      collation: { locale: 'en', strength: 2 },
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'name', direction: 1 }],
      collation: { locale: 'fr', strength: 2 },
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns true for same collation', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'name', direction: 1 }],
      collation: { locale: 'en', strength: 2 },
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'name', direction: 1 }],
      collation: { locale: 'en', strength: 2 },
    });
    expect(sameIndex(a, b)).toBe(true);
  });

  it('returns false for different weights', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'bio', direction: 'text' }],
      weights: { bio: 10 },
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'bio', direction: 'text' }],
      weights: { bio: 5 },
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different default_language', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'bio', direction: 'text' }],
      default_language: 'english',
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'bio', direction: 'text' }],
      default_language: 'french',
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('returns false for different language_override', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'bio', direction: 'text' }],
      language_override: 'lang',
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'bio', direction: 'text' }],
      language_override: 'language',
    });
    expect(sameIndex(a, b)).toBe(false);
  });

  it('treats object-valued options with different key order as equivalent', () => {
    const a = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: { status: 'active', age: { $gte: 18 } },
      collation: { locale: 'en', strength: 2 },
      weights: { title: 10, body: 5 },
      wildcardProjection: { name: 1, email: 1 },
    });
    const b = new MongoSchemaIndex({
      keys: [{ field: 'status', direction: 1 }],
      partialFilterExpression: { age: { $gte: 18 }, status: 'active' },
      collation: { strength: 2, locale: 'en' },
      weights: { body: 5, title: 10 },
      wildcardProjection: { email: 1, name: 1 },
    });
    expect(sameIndex(a, b)).toBe(true);
  });
});

describe('MongoSchemaIR', () => {
  it('constructs with empty collections', () => {
    const ir = new MongoSchemaIR([]);
    expect(ir.nodeKind).toBe('schema');
    expect(ir.collections).toEqual([]);
  });

  it('constructs with collections sorted by name', () => {
    const users = new MongoSchemaCollection({ name: 'users' });
    const posts = new MongoSchemaCollection({ name: 'posts' });
    const ir = new MongoSchemaIR([users, posts]);
    expect(ir.collections).toHaveLength(2);
    expect(ir.collections[0]).toBe(posts);
    expect(ir.collections[1]).toBe(users);
  });

  it('is frozen after construction', () => {
    const ir = new MongoSchemaIR([]);
    expect(Object.isFrozen(ir)).toBe(true);
  });

  it('dispatches via visitor', () => {
    const ir = new MongoSchemaIR([new MongoSchemaCollection({ name: 'users' })]);
    const visitor: MongoSchemaVisitor<string> = {
      schema: (node) => `schema:${node.collections.length}`,
      collection: () => 'collection',
      index: () => 'index',
      validator: () => 'validator',
      collectionOptions: () => 'collectionOptions',
    };
    expect(ir.accept(visitor)).toBe('schema:1');
  });

  it('looks up collection by name', () => {
    const users = new MongoSchemaCollection({ name: 'users' });
    const posts = new MongoSchemaCollection({ name: 'posts' });
    const ir = new MongoSchemaIR([users, posts]);
    expect(ir.collection('users')).toBe(users);
    expect(ir.collection('posts')).toBe(posts);
    expect(ir.collection('missing')).toBeUndefined();
  });

  it('exposes sorted collection names', () => {
    const ir = new MongoSchemaIR([
      new MongoSchemaCollection({ name: 'zebra' }),
      new MongoSchemaCollection({ name: 'alpha' }),
    ]);
    expect(ir.collectionNames).toEqual(['alpha', 'zebra']);
  });
});
