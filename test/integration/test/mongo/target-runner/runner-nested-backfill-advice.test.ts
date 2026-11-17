import type { MongoContract } from '@internal/mongo-contract';
import { MongoCollection } from '@internal/mongo-contract';
import { collMod, renameStoredKey } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contract } from './runner-statements-fixtures';
import { useUsersDatabase } from './runner-users-fixtures';

const live = useUsersDatabase('runner_nested_backfill_advice_test');

function addressSchema(required: readonly string[], street = 'street') {
  return {
    bsonType: 'object',
    required: [street, ...required],
    properties: { [street]: { bsonType: 'string' }, seen: { bsonType: 'date' } },
    additionalProperties: false,
  };
}

function usersSchema(addressRequires: readonly string[], street = 'street') {
  return {
    bsonType: 'object',
    required: ['_id', 'addresses'],
    properties: {
      _id: { bsonType: 'objectId' },
      home: { oneOf: [{ bsonType: 'null' }, addressSchema(addressRequires, street)] },
      addresses: { bsonType: 'array', items: addressSchema(addressRequires, street) },
    },
    additionalProperties: false,
  };
}

const address = (nullable: boolean, many: boolean) => ({
  type: {
    kind: 'valueObject',
    plane: 'storage',
    namespaceId: '__unbound__',
    entityKind: 'valueObject',
    entityName: 'Address',
  },
  nullable,
  ...(many ? { many: { elementNullable: false } } : {}),
});

/** Users holding an `Address` in `home` and a list of them in `addresses`, where `Address.seen` is required and the street is stored as `street`. */
function destination(street = 'street'): MongoContract {
  const base = contract(
    'dest',
    { User: { collection: 'users', fields: ['_id'] } },
    { users: new MongoCollection({}) },
  );
  const user = base.domain.namespaces['__unbound__']?.models['User'];
  return {
    ...base,
    domain: {
      namespaces: {
        __unbound__: {
          models: {
            User: {
              ...user,
              fields: {
                ...user?.fields,
                home: address(true, false),
                addresses: address(false, true),
              },
              storage: {
                collection: 'users',
                fields: {
                  _id: { field: '_id' },
                  home: { field: 'home' },
                  addresses: { field: 'addresses' },
                },
              },
            },
          },
        },
      },
    },
    storage: {
      ...base.storage,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: {
            collection: { users: new MongoCollection({}) },
            valueObject: {
              Address: {
                fields: {
                  [street]: {
                    type: { kind: 'scalar', codecId: 'mongo/string@1' },
                    nullable: false,
                  },
                  seen: { type: { kind: 'scalar', codecId: 'mongo/date@1' }, nullable: false },
                },
              },
            },
          },
        },
      },
    },
  } as unknown as MongoContract;
}

describe('MongoMigrationRunner, a required field new inside a value object', () => {
  it(
    'names the nested keys the change makes required, and the --backfill statement of their field',
    async () => {
      await live.db().createCollection('users', { validator: { $jsonSchema: usersSchema([]) } });
      await live
        .db()
        .collection('users')
        .insertOne({ home: { street: 'Main St' }, addresses: [{ street: 'High St' }] });

      const result = await live.run(
        [
          collMod(
            'users',
            { validator: { $jsonSchema: usersSchema(['seen']) } },
            { id: 'validator.users.update', checkDocuments: true },
          ),
        ],
        destination(),
      );

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain(
        'This validator change makes "addresses.seen" and "home.seen" required and changes what "addresses" and "home" accept.',
      );
      expect(result.failure.why).toContain(
        'To give "addresses.seen" and "home.seen" values you choose, plan the change with --backfill Address.seen, as the steps to take describe.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, a renamed key that a document never held', () => {
  it(
    'offers no --backfill for the key a rename of the same plan gives its name, and leaves the advice to the cause the failure names',
    async () => {
      await live.db().createCollection('users', { validator: { $jsonSchema: usersSchema([]) } });
      await live
        .db()
        .collection('users')
        .insertOne({ home: {}, addresses: [] }, { bypassDocumentValidation: true });

      const result = await live.run(
        [
          renameStoredKey({ collection: 'users', field: 'home', path: '$.street', to: 'line1' }),
          collMod(
            'users',
            { validator: { $jsonSchema: usersSchema([], 'line1') } },
            { id: 'validator.users.update', checkDocuments: true },
          ),
        ],
        destination('line1'),
      );

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect({
        named: result.failure.why?.includes('That document has no "home.line1".'),
        backfill: result.failure.why?.includes('--backfill'),
        rowsWithoutValue: result.failure.meta.rowsWithoutValue,
      }).toEqual({ named: true, backfill: false, rowsWithoutValue: undefined });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner, a list element that is not an object', () => {
  it(
    'says the document holds it when it is the only reason the document does not fit',
    async () => {
      const users = (address: Record<string, unknown>) => ({
        bsonType: 'object',
        required: ['_id', 'addresses'],
        properties: {
          _id: { bsonType: 'objectId' },
          addresses: { bsonType: 'array', items: address },
        },
        additionalProperties: false,
      });
      const lineOptional = {
        bsonType: 'object',
        properties: { line1: { bsonType: 'string' } },
        additionalProperties: false,
      };
      await live
        .db()
        .createCollection('users', { validator: { $jsonSchema: users(addressSchema([])) } });
      await live
        .db()
        .collection('users')
        .insertOne({ addresses: [null] }, { bypassDocumentValidation: true });

      const result = await live.run(
        [
          renameStoredKey({
            collection: 'users',
            field: 'addresses',
            path: '$[*].street',
            to: 'line1',
          }),
          collMod(
            'users',
            { validator: { $jsonSchema: users(lineOptional) } },
            { id: 'validator.users.update', checkDocuments: true },
          ),
        ],
        destination('line1'),
      );

      if (result.ok) throw new Error('Expected the validator change to stop at its document check');
      expect(result.failure.why).toContain(
        'That document holds an element in "addresses" that is not an object.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
