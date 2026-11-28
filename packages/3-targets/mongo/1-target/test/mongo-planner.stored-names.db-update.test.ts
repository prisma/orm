import { describe, expect, it } from 'vitest';
import { contract, plan, planned, renameField, schemaCollection } from './mongo-statement-fixtures';

/** `User` with the fields given, each stored under the name given, in the collection given. */
function users(seed: string, collection: string, fields: Readonly<Record<string, string>>) {
  return contract(
    seed,
    {
      User: {
        collection,
        fields: ['_id', ...Object.keys(fields)],
        storedAs: fields,
        types: Object.fromEntries(
          Object.keys(fields).map((field) => [
            field,
            { codecId: 'mongo/string@1', nullable: true },
          ]),
        ),
      },
    },
    { [collection]: {} },
  );
}

const origin = users('from', 'users', { email: 'email', name: 'name' });

describe('MongoMigrationPlanner, a collection a database already has under its new name', () => {
  it('plans no rename, and renames a field whose @map changes in the new collection', () => {
    expect(
      planned(
        plan({
          from: origin,
          to: users('to', 'app_users', { email: 'email_address', name: 'name' }),
          schema: [schemaCollection('app_users')],
        }),
      ),
    ).toEqual({
      applied: [],
      classes: ['widening'],
      dataLoss: [],
      labels: ['Rename field email to email_address in collection app_users'],
    });
  });

  it('removes a field the destination drops from the new collection, asked about by the origin model and field', () => {
    expect(
      planned(
        plan({
          from: origin,
          to: users('to', 'app_users', { email: 'email' }),
          schema: [schemaCollection('app_users')],
        }),
      ),
    ).toEqual({
      applied: [],
      classes: ['destructive'],
      dataLoss: [
        {
          label: 'Remove field name from collection app_users',
          loss: 'drop',
          operationIndex: 0,
          subject: {
            field: 'name',
            kind: 'field',
            model: 'User',
            namespaceId: '__unbound__',
          },
        },
      ],
      labels: ['Remove field name from collection app_users'],
    });
  });

  it('renames a field a statement names in the new collection', () => {
    expect(
      planned(
        plan({
          from: origin,
          to: users('to', 'app_users', { email: 'email', fullName: 'fullName' }),
          schema: [schemaCollection('app_users')],
          statements: [renameField('User', 'name', 'User', 'fullName')],
        }),
      ),
    ).toEqual({
      applied: [[0]],
      classes: ['widening'],
      dataLoss: [],
      labels: ['Rename field name to fullName in collection app_users'],
    });
  });

  it('plans nothing more when the database has neither collection: the diff creates the new one', () => {
    expect(
      planned(
        plan({
          from: origin,
          to: users('to', 'app_users', { email: 'email', name: 'name' }),
          schema: [],
        }),
      ),
    ).toEqual({
      applied: [],
      classes: ['additive'],
      dataLoss: [],
      labels: ['Create collection app_users'],
    });
  });

  it('refuses when the database has both collections and the origin contract only the old one', () => {
    expect(
      plan({
        from: origin,
        to: users('to', 'app_users', { email: 'email', name: 'name' }),
        schema: [schemaCollection('users'), schemaCollection('app_users')],
      }),
    ).toEqual({
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename collection "users" to "app_users": the database has both collections',
          why: 'The collection of model "User" changes from "users" to "app_users", and the database has both collection "users" and collection "app_users". One of two things happened, and each has its own fix. If the rename was half done by hand, or the application wrote to collection "app_users" before db update ran, collection "users" holds the documents of model "User": move into collection "users" the documents of collection "app_users" that it does not already hold, and where both collections hold a document with the same _id, keep the version you want in collection "users"; then drop collection "app_users", and run again. If collection "users" was renamed to "app_users" by hand and the name "users" then used for another collection, collection "app_users" holds the documents of model "User": drop collection "users", and run again; to keep the documents of that other collection, first move them into a collection the contract has, since db update drops every collection the contract does not have.',
        },
      ],
      kind: 'failure',
    });
  });
});
