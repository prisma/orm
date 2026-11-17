import type { ControlPolicy } from '@internal/contract/types';
import { defaultMongoIndexName } from '@internal/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIndex,
  MongoSchemaIR,
  MongoSchemaValidator,
} from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { diffMongoSchemas } from '../src/core/schema-diff';

const emptyIR = new MongoSchemaIR([], { fromDatabase: false });

const managedCollectionControlPolicy = (): ControlPolicy => 'managed';

function diffMongoSchemasManaged(live: MongoSchemaIR, expected: MongoSchemaIR, strict: boolean) {
  return diffMongoSchemas(live, expected, strict, managedCollectionControlPolicy);
}

function ir(collections: Record<string, MongoSchemaCollection>): MongoSchemaIR {
  return new MongoSchemaIR(Object.values(collections), { fromDatabase: false });
}

function coll(
  name: string,
  opts?: {
    indexes?: MongoSchemaIndex[];
    validator?: MongoSchemaValidator;
    options?: MongoSchemaCollectionOptions;
  },
): MongoSchemaCollection {
  return new MongoSchemaCollection({
    name,
    indexes: opts?.indexes ?? [],
    ...(opts?.validator ? { validator: opts.validator } : {}),
    ...(opts?.options ? { options: opts.options } : {}),
  });
}

function idx(
  keys: Array<{ field: string; direction: 1 | -1 }>,
  opts?: { name?: string; unique?: boolean; sparse?: boolean; expireAfterSeconds?: number },
): MongoSchemaIndex {
  return new MongoSchemaIndex({ name: defaultMongoIndexName(keys), keys, ...opts });
}

function validator(
  jsonSchema: Record<string, unknown>,
  level: 'strict' | 'moderate' = 'strict',
  action: 'error' | 'warn' = 'error',
): MongoSchemaValidator {
  return new MongoSchemaValidator({
    jsonSchema,
    validationLevel: level,
    validationAction: action,
  });
}

describe('diffMongoSchemas', () => {
  describe('empty schemas', () => {
    it('returns no failures or warnings for two empty schemas', () => {
      const result = diffMongoSchemasManaged(emptyIR, emptyIR, false);
      expect(result.failures).toEqual([]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('collections', () => {
    it('returns no failures when collections match', () => {
      const schema = ir({ users: coll('users') });
      const result = diffMongoSchemasManaged(schema, schema, false);
      expect(result.failures).toEqual([]);
    });

    it('fails on missing collection', () => {
      const live = emptyIR;
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([expect.objectContaining({ path: ['users'] })]);
    });

    it('warns on extra collection in non-strict mode', () => {
      const live = ir({ users: coll('users') });
      const expected = emptyIR;
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([]);
      expect(result.warnings).toEqual([expect.objectContaining({ path: ['users'] })]);
    });

    it('fails on extra collection in strict mode', () => {
      const live = ir({ users: coll('users') });
      const expected = emptyIR;
      const result = diffMongoSchemasManaged(live, expected, true);

      expect(result.failures).toEqual([expect.objectContaining({ path: ['users'] })]);
      expect(result.warnings).toEqual([]);
    });
  });

  describe('indexes', () => {
    it('returns no failures or warnings when indexes match', () => {
      const schema = ir({
        users: coll('users', {
          indexes: [idx([{ field: 'email', direction: 1 }], { unique: true })],
        }),
      });
      const result = diffMongoSchemasManaged(schema, schema, false);
      expect(result.failures).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('fails on missing index', () => {
      const live = ir({ users: coll('users') });
      const expected = ir({
        users: coll('users', {
          indexes: [idx([{ field: 'email', direction: 1 }], { unique: true })],
        }),
      });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([
        expect.objectContaining({ path: ['users', 'index:email_1'] }),
      ]);
    });

    it('warns on extra index in non-strict mode', () => {
      const live = ir({
        users: coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] }),
      });
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([]);
      expect(result.warnings).toEqual([
        expect.objectContaining({ path: ['users', 'index:email_1'] }),
      ]);
    });

    it('fails on extra index in strict mode', () => {
      const live = ir({
        users: coll('users', { indexes: [idx([{ field: 'email', direction: 1 }])] }),
      });
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemasManaged(live, expected, true);

      expect(result.failures).toEqual([
        expect.objectContaining({ path: ['users', 'index:email_1'] }),
      ]);
    });
  });

  describe('validators', () => {
    const schema1 = { bsonType: 'object', required: ['name'] };
    const schema2 = { bsonType: 'object', required: ['email'] };

    it('returns no failures when both have no validator', () => {
      const schema = ir({ users: coll('users') });
      const result = diffMongoSchemasManaged(schema, schema, false);
      expect(result.failures).toEqual([]);
    });

    it('returns no failures when validators match', () => {
      const schema = ir({ users: coll('users', { validator: validator(schema1) }) });
      const result = diffMongoSchemasManaged(schema, schema, false);
      expect(result.failures).toEqual([]);
    });

    it('fails on missing validator', () => {
      const live = ir({ users: coll('users') });
      const expected = ir({ users: coll('users', { validator: validator(schema1) }) });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([expect.objectContaining({ path: ['users', 'validator'] })]);
    });

    it('warns on extra validator in non-strict mode', () => {
      const live = ir({ users: coll('users', { validator: validator(schema1) }) });
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([]);
      expect(result.warnings).toEqual([expect.objectContaining({ path: ['users', 'validator'] })]);
    });

    it('fails on extra validator in strict mode', () => {
      const live = ir({ users: coll('users', { validator: validator(schema1) }) });
      const expected = ir({ users: coll('users') });
      const result = diffMongoSchemasManaged(live, expected, true);

      expect(result.failures).toEqual([expect.objectContaining({ path: ['users', 'validator'] })]);
    });

    it('fails on schema mismatch', () => {
      const live = ir({ users: coll('users', { validator: validator(schema1) }) });
      const expected = ir({ users: coll('users', { validator: validator(schema2) }) });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([expect.objectContaining({ path: ['users', 'validator'] })]);
    });

    it('fails when validationLevel differs', () => {
      const live = ir({ users: coll('users', { validator: validator(schema1, 'moderate') }) });
      const expected = ir({ users: coll('users', { validator: validator(schema1, 'strict') }) });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures.length).toBe(1);
    });

    it('fails when validationAction differs', () => {
      const live = ir({
        users: coll('users', { validator: validator(schema1, 'strict', 'warn') }),
      });
      const expected = ir({
        users: coll('users', { validator: validator(schema1, 'strict', 'error') }),
      });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures.length).toBe(1);
    });
  });

  describe('options', () => {
    const cappedOpts = new MongoSchemaCollectionOptions({ capped: { size: 1048576 } });
    const differentOpts = new MongoSchemaCollectionOptions({ capped: { size: 2097152 } });

    it('returns no failures when both have no options', () => {
      const schema = ir({ users: coll('users') });
      const result = diffMongoSchemasManaged(schema, schema, false);
      expect(result.failures).toEqual([]);
    });

    it('returns no failures when options match', () => {
      const schema = ir({ logs: coll('logs', { options: cappedOpts }) });
      const result = diffMongoSchemasManaged(schema, schema, false);
      expect(result.failures).toEqual([]);
    });

    it('warns on extra options in non-strict mode', () => {
      const live = ir({ logs: coll('logs', { options: cappedOpts }) });
      const expected = ir({ logs: coll('logs') });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([]);
      expect(result.warnings.length).toBe(1);
    });

    it('fails on extra options in strict mode', () => {
      const live = ir({ logs: coll('logs', { options: cappedOpts }) });
      const expected = ir({ logs: coll('logs') });
      const result = diffMongoSchemasManaged(live, expected, true);

      expect(result.failures.length).toBe(1);
    });

    it('fails on options mismatch', () => {
      const live = ir({ logs: coll('logs', { options: cappedOpts }) });
      const expected = ir({ logs: coll('logs', { options: differentOpts }) });
      const result = diffMongoSchemasManaged(live, expected, false);

      expect(result.failures).toEqual([expect.objectContaining({ path: ['logs', 'options'] })]);
    });
  });

  describe('index lookup-key composition', () => {
    // Locks in the truthy branches of `buildIndexLookupKey` for the optional
    // index fields so that two indexes with identical sparse/TTL/partial-filter/
    // wildcard-projection settings match by their composed lookup key.
    it('matches indexes that share sparse, TTL, partial filter and wildcard projection', () => {
      const richIndex = new MongoSchemaIndex({
        name: 'createdAt_1',
        keys: [{ field: 'createdAt', direction: 1 }],
        unique: true,
        sparse: true,
        expireAfterSeconds: 3600,
        partialFilterExpression: { archived: false },
        wildcardProjection: { 'meta.$**': 1 },
      });
      const schema = ir({ events: coll('events', { indexes: [richIndex] }) });

      const result = diffMongoSchemasManaged(schema, schema, true);

      expect(result.failures).toEqual([]);
      expect(result.warnings).toEqual([]);
    });

    it('treats indexes that differ only in sparse/TTL/partial/wildcard as distinct', () => {
      const live = ir({
        events: coll('events', {
          indexes: [
            new MongoSchemaIndex({
              name: 'createdAt_1',
              keys: [{ field: 'createdAt', direction: 1 }],
              sparse: true,
              expireAfterSeconds: 60,
              partialFilterExpression: { archived: false },
              wildcardProjection: { 'meta.$**': 1 },
            }),
          ],
        }),
      });
      const expected = ir({
        events: coll('events', {
          indexes: [
            new MongoSchemaIndex({
              name: 'createdAt_1',
              keys: [{ field: 'createdAt', direction: 1 }],
            }),
          ],
        }),
      });

      const result = diffMongoSchemasManaged(live, expected, true);

      // Different lookup keys → expected index is missing and live index is
      // extra. Both reach `fail` under strict mode.
      expect(result.failures.length).toBeGreaterThanOrEqual(1);
      expect(result.failures).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ path: ['events', 'index:createdAt_1'] }),
          expect.objectContaining({
            path: ['events', 'index:createdAt_1'],
          }),
        ]),
      );
    });
  });
});
