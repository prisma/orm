import { describe, expect, it } from 'vitest';
import { mongoContractCanonicalizationHooks } from '../src/canonicalization-hooks';

const { shouldPreserveEmpty } = mongoContractCanonicalizationHooks;

describe('mongoContractCanonicalizationHooks.shouldPreserveEmpty', () => {
  it('preserves additionalProperties at the top level of a collection schema', () => {
    expect(
      shouldPreserveEmpty([
        'storage',
        'namespaces',
        'app',
        'entries',
        'collection',
        'users',
        'validator',
        'jsonSchema',
        'additionalProperties',
      ]),
    ).toBe(true);
  });

  it('preserves additionalProperties nested inside an embedded value object', () => {
    expect(
      shouldPreserveEmpty([
        'storage',
        'namespaces',
        'app',
        'entries',
        'collection',
        'users',
        'validator',
        'jsonSchema',
        'properties',
        'address',
        'additionalProperties',
      ]),
    ).toBe(true);
  });

  it('preserves additionalProperties inside a polymorphic oneOf branch', () => {
    expect(
      shouldPreserveEmpty([
        'storage',
        'namespaces',
        'app',
        'entries',
        'collection',
        'events',
        'validator',
        'jsonSchema',
        'oneOf',
        '0',
        'additionalProperties',
      ]),
    ).toBe(true);
  });

  const collectionSchema = [
    'storage',
    'namespaces',
    'app',
    'entries',
    'collection',
    'posts',
    'validator',
    'jsonSchema',
  ];

  it('preserves the empty schema of a field the validator admits unconstrained', () => {
    expect(shouldPreserveEmpty([...collectionSchema, 'properties', 'meta'])).toBe(true);
  });

  it('preserves an unconstrained field schema inside an embedded value object', () => {
    expect(
      shouldPreserveEmpty([...collectionSchema, 'properties', 'address', 'properties', 'meta']),
    ).toBe(true);
  });

  it('preserves the empty item schema of an unconstrained array field', () => {
    expect(shouldPreserveEmpty([...collectionSchema, 'properties', 'tags', 'items'])).toBe(true);
  });

  it('does not preserve an empty properties map itself', () => {
    expect(shouldPreserveEmpty([...collectionSchema, 'properties'])).toBe(false);
  });

  it('does not preserve an empty entry named properties outside a validator schema', () => {
    expect(
      shouldPreserveEmpty(['domain', 'namespaces', 'app', 'models', 'properties', 'relations']),
    ).toBe(false);
  });

  it('preserves the empty collection slot', () => {
    expect(shouldPreserveEmpty(['storage', 'namespaces', 'app', 'entries', 'collection'])).toBe(
      true,
    );
  });

  it('does not preserve unrelated empty defaults', () => {
    expect(shouldPreserveEmpty(['storage', 'namespaces', 'app', 'somethingElse'])).toBe(false);
  });
});
