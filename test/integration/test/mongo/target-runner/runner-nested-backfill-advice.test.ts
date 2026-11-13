import type { MongoContract } from '@internal/mongo-contract';
import { MongoCollection } from '@internal/mongo-contract';
import { collMod } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contract } from './runner-statements-fixtures';
import { useUsersDatabase } from './runner-users-fixtures';

const live = useUsersDatabase('runner_nested_backfill_advice_test');

function addressSchema(required: readonly string[]) {
  return {
    bsonType: 'object',
    required: ['street', ...required],
    properties: { street: { bsonType: 'string' }, seen: { bsonType: 'date' } },
    additionalProperties: false,
  };
}

function usersSchema(addressRequires: readonly string[]) {
  return {
    bsonType: 'object',
    required: ['_id', 'addresses'],
    properties: {
      _id: { bsonType: 'objectId' },
      home: { oneOf: [{ bsonType: 'null' }, addressSchema(addressRequires)] },
      addresses: { bsonType: 'array', items: addressSchema(addressRequires) },
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

/** Users holding an `Address` in `home` and a list of them in `addresses`, where `Address.seen` is required. */
function destination(): MongoContract {
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
                  street: { type: { kind: 'scalar', codecId: 'mongo/string@1' }, nullable: false },
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
        'To give "addresses.seen" and "home.seen" values you choose, plan the change with migration plan --backfill Address.seen.',
      );
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
