import { describe, expect, it } from 'vitest';
import {
  contract,
  NS,
  plan,
  planned,
  renameModel,
  schemaCollection,
  sharedJsonSchema,
} from './mongo-statement-fixtures';

/** `Admin` and `User`, root models stored in one collection with no discriminator. */
function shared(
  seed: string,
  collections: { readonly admin: string; readonly user: string },
  userStoredAs: Readonly<Record<string, string>> = {},
  user = 'User',
) {
  const names = [...new Set([collections.admin, collections.user])];
  return contract(
    seed,
    {
      Admin: { collection: collections.admin, fields: ['_id', 'level'] },
      [user]: { collection: collections.user, fields: ['_id', 'level'], storedAs: userStoredAs },
    },
    Object.fromEntries(
      names.map((name) => [name, { jsonSchema: sharedJsonSchema(['level'], ['level']) }]),
    ),
  );
}

const MERGED_ADVICE =
  'The destination stores models "Admin" and "User" in collection "people", and the origin stores them in different collections, so their storage is being merged. Keeping their documents is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of models "Admin" and "User" into collection "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.';

const liveUsers = [
  schemaCollection('users', { jsonSchema: sharedJsonSchema(['level'], ['level']) }),
];

describe('MongoMigrationPlanner, a collection that several root models share', () => {
  it('renames nothing when one of the root models moves to another collection, and moves no document of the other', () => {
    const result = plan({
      from: shared('from', { admin: 'users', user: 'users' }),
      to: shared('to', { admin: 'users', user: 'members' }),
      schema: liveUsers,
    });
    expect(planned(result)).toEqual({
      labels: ['Create collection members'],
      classes: ['additive'],
      applied: [],
      dataLoss: [],
    });
  });

  it('asks nothing about a root model the destination removes from a collection another root model stays in, since nothing is deleted', () => {
    const result = plan({
      from: shared('from', { admin: 'users', user: 'users' }),
      to: shared('to', { admin: 'users', user: 'members' }, {}, 'Member'),
      schema: liveUsers,
    });
    expect(planned(result)).toEqual({
      labels: ['Create collection members'],
      classes: ['additive'],
      applied: [],
      dataLoss: [],
    });
  });

  it('renames nothing when two root models of their own collections move to one new collection, and says the merge is a data migration', () => {
    expect(
      planned(
        plan({
          from: shared('from', { admin: 'admins', user: 'users' }),
          to: shared('to', { admin: 'people', user: 'people' }),
          schema: [
            schemaCollection('admins', { jsonSchema: sharedJsonSchema(['level'], ['level']) }),
            ...liveUsers,
          ],
        }),
      ),
    ).toEqual({
      labels: ['Create collection people', 'Drop collection admins', 'Drop collection users'],
      classes: ['additive', 'destructive', 'destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'model', namespaceId: NS, model: 'Admin' },
          loss: 'drop',
          label: 'Drop collection admins',
          keepDataAdvice: MERGED_ADVICE,
        },
        {
          operationIndex: 2,
          subject: { kind: 'model', namespaceId: NS, model: 'User' },
          loss: 'drop',
          label: 'Drop collection users',
          keepDataAdvice: MERGED_ADVICE,
        },
      ],
    });
  });

  const userAlone = (seed: string, collection: string, user = 'User') =>
    contract(
      seed,
      { [user]: { collection, fields: ['_id', 'level'] } },
      { [collection]: { required: ['level'] } },
    );

  it.each([
    ['Admin first', ['Admin', 'User']],
    ['User first', ['User', 'Admin']],
  ] as const)(
    'renames the collection when the destination removes one root model and moves the other, since the model that stays reads the documents it read before (%s)',
    (_, order) => {
      const from = contract(
        'from',
        Object.fromEntries(
          order.map((model) => [model, { collection: 'users', fields: ['_id', 'level'] }]),
        ),
        { users: { jsonSchema: sharedJsonSchema(['level'], ['level']) } },
      );
      expect(planned(plan({ from, to: userAlone('to', 'members'), schema: liveUsers }))).toEqual({
        labels: ['Rename collection users to members', 'Update validator on members'],
        classes: ['widening', 'widening'],
        applied: [],
        dataLoss: [],
      });
    },
  );

  it('plans a model rename statement on a collection whose other root model the destination removes', () => {
    const statement = renameModel('User', 'Member');
    expect(
      planned(
        plan({
          from: shared('from', { admin: 'users', user: 'users' }),
          to: userAlone('to', 'members', 'Member'),
          schema: liveUsers,
          statements: [statement],
        }),
      ),
    ).toEqual({
      labels: ['Rename collection users to members', 'Update validator on members'],
      classes: ['widening', 'widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('renames the collection once when every root model moves to the same collection', () => {
    expect(
      planned(
        plan({
          from: shared('from', { admin: 'users', user: 'users' }),
          to: shared('to', { admin: 'people', user: 'people' }),
          schema: liveUsers,
        }),
      ),
    ).toEqual({
      labels: ['Rename collection users to people'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('refuses a model rename statement that would move the documents of the other root model', () => {
    const statement = renameModel('User', 'Member');
    const result = plan({
      from: shared('from', { admin: 'users', user: 'users' }),
      to: shared('to', { admin: 'users', user: 'members' }, {}, 'Member'),
      schema: liveUsers,
      statements: [statement],
    });
    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "User" to "Member": collection "users" also stores model "Admin"',
          why: 'A collection rename moves every document of the collection, and the documents of model "Admin" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.\n\nLeave out --rename User:Member to plan the change without moving them. Model "User" is then removed and nothing is asked, since nothing is deleted. Its documents stay in collection "users", where model "Admin" still reads them. Model "Member" starts with no documents. If the new validator of collection "users" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there.\n\nWith migration plan, keep the documents by moving them in the migration that plan writes. Plan the change without --rename User:Member.\n\nIn the operations of the migration.ts it writes, right after the creation of collection "members" and before the plan\'s own operations on collection "users", add a dataTransform. Its run copies the documents of model "User" into collection "members":\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "members" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "User" from collection "users":\n\n  deleteDocuments({ collection: "users", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "users", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "User" stores. If it stores none, no field tells its documents apart: select them by their _id values instead.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nStop writes to each collection the documents move out of until the apply succeeds, re-runs included: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, re-runs included: a document written there after the check could hold the _id of a document that moves.\n\nIf the apply stops, fix what stopped it and run db migrate again.',
          refusedStatement: statement,
        },
      ],
    });
  });

  it('refuses the field rename of one root model whose @map changes while the collection moves whole, naming the contract change', () => {
    expect(
      plan({
        from: shared('from', { admin: 'users', user: 'users' }),
        to: shared('to', { admin: 'people', user: 'people' }, { level: 'rank' }),
        schema: liveUsers,
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename field "level" to "rank" in collection "people": model "Admin" stores field "level" in the same collection, "people"',
          why: 'The stored name of field "User.level" changes from "level" to "rank". Collection "people" stores several models and no discriminator tells their documents apart, so renaming the field would rename it in the documents of "Admin" too. To change it, move the models to separate collections, or keep the stored name "level" in the contract.',
        },
      ],
    });
  });

  it('puts the move first, and names the documents the renamed model reads, when it moves into a collection that already exists', () => {
    const statement = renameModel('User', 'Member');
    const result = plan({
      from: contract(
        'from',
        {
          Admin: { collection: 'users', fields: ['_id', 'admin'] },
          User: { collection: 'users', fields: ['_id', 'user'] },
          Guest: { collection: 'members', fields: ['_id', 'guest'] },
        },
        { users: {}, members: {} },
      ),
      to: contract(
        'to',
        {
          Admin: { collection: 'users', fields: ['_id', 'admin'] },
          Member: { collection: 'members', fields: ['_id', 'user'] },
          Guest: { collection: 'members', fields: ['_id', 'guest'] },
        },
        { users: {}, members: {} },
      ),
      schema: [schemaCollection('users'), schemaCollection('members')],
      statements: [statement],
    });
    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "User" to "Member": collection "users" also stores model "Admin"',
          why: 'A collection rename moves every document of the collection, and the documents of model "Admin" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.\n\nLeave out --rename User:Member to plan the change without moving them. Model "User" is then removed and nothing is asked, since nothing is deleted. Its documents stay in collection "users", where model "Admin" still reads them. Model "Member" reads the documents of model "Guest" already stored in its collection, since no discriminator tells them apart. If the new validator of collection "users" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there.\n\nWith migration plan, keep the documents by moving them in the migration that plan writes. Plan the change without --rename User:Member.\n\nAt the start of the operations of the migration.ts it writes, before the plan\'s own operations on collection "users", add a dataTransform. Its run copies the documents of model "User" into collection "members":\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "members" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "User" from collection "users":\n\n  deleteDocuments({ collection: "users", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "users", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "User" stores. If it stores none, no field tells its documents apart: select them by their _id values instead.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nStop writes to each collection the documents move out of until the apply succeeds, re-runs included: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, re-runs included: a document written there after the check could hold the _id of a document that moves.\n\nIf the apply stops, fix what stopped it and run db migrate again.',
          refusedStatement: statement,
        },
      ],
    });
  });

  it('puts the move first when the new collection gets an index and no createCollection', () => {
    const statement = renameModel('User', 'Member');
    const from = contract(
      'from',
      {
        Admin: { collection: 'users', fields: ['_id', 'admin'] },
        User: { collection: 'users', fields: ['_id', 'user'] },
      },
      { users: {} },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'users', fields: ['_id', 'admin'] },
        Member: { collection: 'members', fields: ['_id', 'user'] },
      },
      { users: {}, members: { unique: ['user'] } },
    );
    const schema = [schemaCollection('users')];
    const refused = plan({ from, to, schema, statements: [statement] });
    expect(planned(plan({ from, to, schema })).labels).toEqual([
      'Create index user_1 on members (user:1)',
    ]);
    expect(refused).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "User" to "Member": collection "users" also stores model "Admin"',
          why: 'A collection rename moves every document of the collection, and the documents of model "Admin" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.\n\nLeave out --rename User:Member to plan the change without moving them. Model "User" is then removed and nothing is asked, since nothing is deleted. Its documents stay in collection "users", where model "Admin" still reads them. Model "Member" starts with no documents. If the new validator of collection "users" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there.\n\nWith migration plan, keep the documents by moving them in the migration that plan writes. Plan the change without --rename User:Member.\n\nAt the start of the operations of the migration.ts it writes, before the plan\'s own operations on collection "users", add a dataTransform. Its run copies the documents of model "User" into collection "members":\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "members" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "User" from collection "users":\n\n  deleteDocuments({ collection: "users", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "users", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "User" stores. If it stores none, no field tells its documents apart: select them by their _id values instead.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nStop writes to each collection the documents move out of until the apply succeeds, re-runs included: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, re-runs included: a document written there after the check could hold the _id of a document that moves.\n\nIf the apply stops, fix what stopped it and run db migrate again.',
          refusedStatement: statement,
        },
      ],
    });
  });

  it('names every model whose documents leave a collection whose storage is being split', () => {
    const from = contract(
      'from',
      {
        Bot: { collection: 'users', fields: ['_id', 'token'] },
        Staff: { collection: 'users', fields: ['_id', 'badge'] },
        User: { collection: 'users', fields: ['_id', 'name'] },
      },
      { users: {} },
    );
    const to = contract(
      'to',
      {
        Bot: { collection: 'bots', fields: ['_id', 'token'] },
        Member: { collection: 'members', fields: ['_id', 'name'] },
        Staff: { collection: 'crew', fields: ['_id', 'badge'] },
      },
      { bots: {}, crew: {}, members: {} },
    );
    const result = plan({ from, to, schema: [schemaCollection('users')] });
    const advice =
      'The origin stores models "Bot", "Staff" and "User" in collection "users", and the destination stores them in different collections, so their storage is being split. Keeping their documents is a data migration, which a plan does not write. With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "Bot" into collection "bots" and the documents of model "Staff" into collection "crew" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json. The documents of model "User" leave collection "users" too, and the destination removes that model: to keep them, rewrite them in the same migration into the collection of the model that takes them over.';
    expect(planned(result).dataLoss.map(({ keepDataAdvice }) => keepDataAdvice)).toEqual([
      advice,
      advice,
      undefined,
    ]);
  });

  describe('a model new to the collection', () => {
    const guestFrom = { collection: 'members', fields: ['_id', 'guest', 'name'] };
    const from = contract('from', { Guest: guestFrom }, { members: {} });
    const schema = [schemaCollection('members')];

    it("refuses another model's field @map change when the new model stores the same name, and names the earlier migration", () => {
      const to = contract(
        'to',
        {
          Member: { collection: 'members', fields: ['_id', 'name'] },
          Guest: { ...guestFrom, storedAs: { name: 'fullName' } },
        },
        { members: {} },
      );
      expect({
        alone: planned(
          plan({
            from,
            to: contract(
              'alone',
              { Guest: { ...guestFrom, storedAs: { name: 'fullName' } } },
              { members: {} },
            ),
            schema,
          }),
        ).labels,
        beside: plan({ from, to, schema }),
      }).toEqual({
        alone: ['Rename field name to fullName in collection members'],
        beside: {
          kind: 'failure',
          conflicts: [
            {
              kind: 'unsupportedOperation',
              summary:
                'Cannot rename field "name" to "fullName" in collection "members": model "Member" stores field "name" in the same collection, "members"',
              why: 'The stored name of field "Guest.name" changes from "name" to "fullName". Collection "members" stores several models and no discriminator tells their documents apart, so renaming the field would rename it in the documents of "Member" too. To change it, move the models to separate collections, or keep the stored name "name" in the contract. Or make the change in an earlier migration, before model "Member" is added to collection "members".',
            },
          ],
        },
      });
    });

    it("refuses another model's cast when the new model stores the field", () => {
      const STR = { codecId: 'mongo/string@1' };
      const INT = { codecId: 'mongo/int32@1' };
      const age = (codec: { codecId: string }) => ({
        collection: 'members',
        fields: ['_id', 'guest', 'age'],
        types: { age: codec },
      });
      expect(
        plan({
          from: contract('from', { Guest: age(STR) }, { members: {} }),
          to: contract(
            'to',
            {
              Member: { collection: 'members', fields: ['_id', 'age'], types: { age: INT } },
              Guest: age(INT),
            },
            { members: {} },
          ),
          schema,
        }),
      ).toMatchObject({
        kind: 'failure',
        conflicts: [
          {
            kind: 'typeChangeRefused',
            summary:
              'Cannot cast field "age" of model "Guest" in collection "members": model "Member" stores it in the same collection',
          },
        ],
      });
    });
  });
});
