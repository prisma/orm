import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { MongoCollection, type MongoContract } from '@internal/mongo-contract';
import {
  MongoSchemaCollection,
  MongoSchemaCollectionOptions,
  MongoSchemaIR,
} from '@internal/mongo-schema-ir';
import { describe, expect, it } from 'vitest';
import { verifyMongoSchema } from '../src/core/schema-verify/verify-mongo-schema';

function contractWith(options: Record<string, unknown>): MongoContract {
  return {
    target: 'mongo',
    targetFamily: 'mongo',
    roots: {},
    models: {},
    storage: {
      storageHash: 'test',
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          id: UNBOUND_NAMESPACE_ID,
          entries: { collection: { posts: new MongoCollection({ indexes: [], options }) } },
        },
      },
    },
    capabilities: {},
    extensions: {},
    profileHash: 'profile',
    meta: {},
  } as unknown as MongoContract;
}

function verifies(options: Record<string, unknown>, live?: MongoSchemaCollectionOptions) {
  const schema = new MongoSchemaIR(
    [new MongoSchemaCollection({ name: 'posts', indexes: [], ...(live ? { options: live } : {}) })],
    { fromDatabase: true },
  );
  return verifyMongoSchema({
    contract: contractWith(options),
    schema,
    strict: true,
    frameworkComponents: [],
  }).ok;
}

describe('verifyMongoSchema, options MongoDB reports otherwise than given', () => {
  it('takes the simple collation, which MongoDB does not report, as no collation', () => {
    expect(verifies({ collation: { locale: 'simple' } })).toBe(true);
  });

  it('takes a cap with no limit on the number of documents as the limit MongoDB reports', () => {
    expect(
      verifies(
        { capped: { size: 4096, max: 0 } },
        new MongoSchemaCollectionOptions({ capped: { size: 4096, max: 2147483647 } }),
      ),
    ).toBe(true);
  });

  it('takes a fractional cap size as the whole size MongoDB reports', () => {
    expect(
      verifies(
        { capped: { size: 4096.5 } },
        new MongoSchemaCollectionOptions({ capped: { size: 4096 } }),
      ),
    ).toBe(true);
  });

  it('still reports a collation MongoDB does report', () => {
    expect(verifies({ collation: { locale: 'fr' } })).toBe(false);
  });
});
