import { canonicalizeContractToObject } from '@internal/contract/hashing';
import type { Contract } from '@internal/contract/types';
import { blindCast } from '@internal/utils/casts';
import type { JsonObject } from '@internal/utils/json';
import { describe, expect, it } from 'vitest';
import {
  mongoContractCanonicalizationHooks,
  mongoContractSerializationPreserveEmpty,
} from '../src/canonicalization-hooks';

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

describe('canonicalization of model storage', () => {
  it('keeps the empty fields and storage fields of a variant with no fields of its own', () => {
    const epic = {
      fields: {},
      relations: {},
      base: { namespace: 'app', model: 'Task' },
      storage: { collection: 'tasks', fields: {} },
    };
    const contract: Contract = blindCast({
      targetFamily: 'mongo',
      target: 'mongo',
      profileHash: 'test-profile',
      roots: {},
      domain: { namespaces: { app: { models: { Epic: epic } } } },
      storage: { namespaces: {} },
      extensions: {},
      capabilities: {},
      meta: {},
    });

    const result = canonicalizeContractToObject(contract, {
      serializeContract: (c) =>
        blindCast<JsonObject, 'test contract literal is already plain JSON data'>(c),
      shouldPreserveEmpty,
    });

    expect(result['domain']).toEqual({ namespaces: { app: { models: { Epic: epic } } } });
  });
});

describe('canonicalization of codec type parameters', () => {
  const typeParams = { schema: [{ unit: false }], options: {}, list: [] };
  const scalar = { kind: 'scalar', codecId: 'acme/json@1', typeParams };
  const fields = {
    flag: { nullable: false, type: scalar },
    either: { nullable: false, type: { kind: 'union', members: [scalar] } },
  };
  const contract: Contract = blindCast({
    targetFamily: 'mongo',
    target: 'mongo',
    profileHash: 'test-profile',
    roots: {},
    domain: {
      namespaces: {
        app: {
          models: {
            Setting: { fields, relations: {}, storage: { collection: 'settings', fields: {} } },
          },
        },
      },
    },
    storage: {
      namespaces: { app: { id: 'app', entries: { valueObject: { Prefs: { fields } } } } },
    },
    extensions: {},
    capabilities: {},
    meta: {},
  });

  const canonicalize = (preserve: (path: readonly string[]) => boolean) =>
    canonicalizeContractToObject(contract, {
      serializeContract: (c) =>
        blindCast<JsonObject, 'test contract literal is already plain JSON data'>(c),
      shouldPreserveEmpty: preserve,
    });

  it('keeps false, [] and {} inside typeParams when a contract is written', () => {
    const result = canonicalize(mongoContractSerializationPreserveEmpty);
    expect({ domain: result['domain'], storage: result['storage'] }).toEqual({
      domain: {
        namespaces: {
          app: {
            models: {
              Setting: { fields, relations: {}, storage: { collection: 'settings', fields: {} } },
            },
          },
        },
      },
      storage: {
        namespaces: { app: { id: 'app', entries: { valueObject: { Prefs: { fields } } } } },
      },
    });
  });

  it('leaves the hashing predicate unchanged, so no storage hash changes', () => {
    const storage = blindCast<
      {
        namespaces: {
          app: { entries: { valueObject: { Prefs: { fields: { flag: { type: unknown } } } } } };
        };
      },
      'canonicalization keeps the shape of the test contract'
    >(canonicalize(shouldPreserveEmpty)['storage']);
    expect(storage.namespaces.app.entries.valueObject.Prefs.fields.flag.type).toEqual({
      kind: 'scalar',
      codecId: 'acme/json@1',
      typeParams: { schema: [{}] },
    });
  });
});
