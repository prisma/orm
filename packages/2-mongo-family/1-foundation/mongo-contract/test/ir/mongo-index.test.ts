import { IRNodeBase } from '@internal/framework-components/ir';
import { describe, expect, it } from 'vitest';
import { MongoIndex } from '../../src/ir/mongo-index';

describe('MongoIndex', () => {
  it('constructs from a name and keys', () => {
    const idx = new MongoIndex({ name: 'email_1', keys: [{ field: 'email', direction: 1 }] });
    expect(idx.kind).toBe('mongo-index');
    expect(idx.name).toBe('email_1');
    expect(idx.keys).toEqual([{ field: 'email', direction: 1 }]);
    expect(idx.unique).toBeUndefined();
  });

  it('carries optional storage fields when provided', () => {
    const idx = new MongoIndex({
      name: 'email_1',
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
      sparse: true,
      expireAfterSeconds: 3600,
      partialFilterExpression: { status: { $eq: 'active' } },
      wildcardProjection: { name: 1 },
      collation: { locale: 'en', strength: 2 },
      weights: { bio: 10 },
      default_language: 'english',
      language_override: 'lang',
    });
    expect(idx.unique).toBe(true);
    expect(idx.sparse).toBe(true);
    expect(idx.expireAfterSeconds).toBe(3600);
    expect(idx.partialFilterExpression).toEqual({ status: { $eq: 'active' } });
    expect(idx.wildcardProjection).toEqual({ name: 1 });
    expect(idx.collation).toEqual({ locale: 'en', strength: 2 });
    expect(idx.weights).toEqual({ bio: 10 });
    expect(idx.default_language).toBe('english');
    expect(idx.language_override).toBe('lang');
  });

  it('extends IRNodeBase and freezes', () => {
    const idx = new MongoIndex({ name: 'email_1', keys: [{ field: 'email', direction: 1 }] });
    expect(idx).toBeInstanceOf(IRNodeBase);
    expect(idx).toBeInstanceOf(MongoIndex);
    expect(Object.isFrozen(idx)).toBe(true);
  });

  it('omits undeclared optional fields from canonical JSON', () => {
    const idx = new MongoIndex({
      name: 'User_email_key',
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
    expect(JSON.parse(JSON.stringify(idx))).toEqual({
      kind: 'mongo-index',
      name: 'User_email_key',
      keys: [{ field: 'email', direction: 1 }],
      unique: true,
    });
  });
});
