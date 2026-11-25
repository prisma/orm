import { asNamespaceId } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  contract,
  plan,
  profiles,
  profilesSchema,
  refusal,
  renameField,
  renameModel,
  schemaCollection,
  users,
} from './mongo-statement-fixtures';

describe('MongoMigrationPlanner, statements it refuses', () => {
  it('refuses renaming a namespace', () => {
    expect(
      refusal(
        plan({
          from: profiles,
          to: profiles,
          schema: profilesSchema,
          statements: [
            {
              kind: 'rename',
              entity: 'namespace',
              from: asNamespaceId('billing'),
              to: asNamespaceId('finance'),
            },
          ],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename namespace "billing" to "finance": MongoDB does not rename namespaces in this release',
        why: 'Leave out this statement.',
      },
    ]);
  });

  it('refuses renaming _id', () => {
    const to = contract(
      'to',
      { Profile: { collection: 'profiles', fields: ['key', 'name'] } },
      { profiles: { unique: ['name'], required: ['name'] } },
    );
    expect(
      refusal(
        plan({
          from: profiles,
          to,
          schema: profilesSchema,
          statements: [renameField('Profile', '_id', 'Profile', 'key')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary: 'Cannot rename field "Profile._id" to "Profile.key": it renames _id',
        why: 'MongoDB does not let a document change its _id. Leave out this statement.',
      },
    ]);
  });

  it('refuses renaming a stored field whose name MongoDB reads as a path, and says to rename it by hand', () => {
    const named = (field: string) =>
      contract(
        field,
        { Profile: { collection: 'profiles', fields: ['_id', field] } },
        { profiles: {} },
      );
    expect(
      refusal(
        plan({
          from: named('o.d'),
          to: named('od'),
          schema: [schemaCollection('profiles')],
          statements: [renameField('Profile', 'o.d', 'Profile', 'od')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename field "Profile.o.d" to "Profile.od": the stored name "o.d" cannot be rewritten',
        why: 'MongoDB reads a name containing "." as a path into embedded documents, so a statement cannot move its values. Rename it in the database yourself, or leave out this statement.',
      },
    ]);
  });

  it('refuses a stored name MongoDB reads as a path or an operator', () => {
    const to = (field: string) =>
      contract(
        field,
        { Profile: { collection: 'profiles', fields: ['_id', field] } },
        { profiles: {} },
      );
    expect(
      ['a.b', '$a'].flatMap((field) =>
        refusal(
          plan({
            from: to('name'),
            to: to(field),
            schema: [schemaCollection('profiles')],
            statements: [renameField('Profile', 'name', 'Profile', field)],
          }),
        ).map(({ summary }) => summary),
      ),
    ).toEqual([
      'Cannot rename field "Profile.name" to "Profile.a.b": the stored name "a.b" cannot be written',
      'Cannot rename field "Profile.name" to "Profile.$a": the stored name "$a" cannot be written',
    ]);
  });

  it('refuses renaming a time-series collection, a collection the schema does not have, and onto a name it already has', () => {
    const statements = [renameModel('Profile', 'User')];
    expect(
      [
        [schemaCollection('profiles', { unique: ['name'], required: ['name'], timeseries: true })],
        [],
        [...profilesSchema, schemaCollection('users')],
      ].flatMap((schema) =>
        refusal(plan({ from: profiles, to: users, schema, statements })).map(
          ({ summary }) => summary,
        ),
      ),
    ).toEqual([
      'Cannot rename model "Profile" to "User": collection "profiles" is a time-series collection',
      'Cannot rename model "Profile" to "User": the schema being planned from has no collection "profiles"',
      'Cannot rename model "Profile" to "User": the schema being planned from already has a collection "users"',
    ]);
  });

  it('gives both routes for a time-series collection, each saying to stop writes until the source is dropped', () => {
    expect(
      refusal(
        plan({
          from: profiles,
          to: users,
          schema: [schemaCollection('profiles', { timeseries: true })],
          statements: [renameModel('Profile', 'User')],
        }),
      ).map(({ why }) => why),
    ).toEqual([
      'MongoDB cannot rename a time-series collection. Leave out this statement. With db update, first create collection "users" yourself with the time-series options of collection "profiles", which db.getCollectionInfos({ name: "profiles" }) shows in mongosh, stop writes to collection "profiles", copy the documents into it, and run db update again with --delete naming the model, which drops "profiles"; allow writes again once it has run, since a document written to "profiles" after the copy is dropped with it. With migration plan, plan with --delete naming the model; the migration.ts it writes creates collection "users", and there add a dataTransform that copies the documents right after that creation and before the drop of collection "profiles". Then run that migration.ts to emit its ops.json, stop writes to collection "profiles", and apply it with db migrate; allow writes again once it has run, since a document written to "profiles" after the copy is dropped with it.',
    ]);
  });

  it('refuses a collection name MongoDB rejects', () => {
    const to = (collection: string) =>
      contract('to', { User: { collection, fields: ['_id', 'name'] } }, { [collection]: {} });
    expect(
      ['a$b', 'system.users', 'a\0b'].flatMap((collection) =>
        refusal(
          plan({
            from: profiles,
            to: to(collection),
            schema: profilesSchema,
            statements: [renameModel('Profile', 'User')],
          }),
        ).map(({ summary }) => summary),
      ),
    ).toEqual([
      'Cannot rename model "Profile" to "User": MongoDB does not accept the collection name "a$b": it contains "$"',
      'Cannot rename model "Profile" to "User": MongoDB does not accept the collection name "system.users": it starts with "system.", which MongoDB reserves',
      'Cannot rename model "Profile" to "User": MongoDB does not accept the collection name "a\0b": it contains a null character',
    ]);
  });

  it('refuses a field stored on one side of the statement only', () => {
    const to = contract(
      'to',
      { Profile: { collection: 'profiles', fields: ['_id', 'name'], relations: ['owner'] } },
      { profiles: { unique: ['name'], required: ['name'] } },
    );
    const from = contract(
      'from',
      { Profile: { collection: 'profiles', fields: ['_id', 'name', 'ownerName'] } },
      { profiles: { unique: ['name'], required: ['name'] } },
    );
    expect(
      refusal(
        plan({
          from,
          to,
          schema: profilesSchema,
          statements: [renameField('Profile', 'ownerName', 'Profile', 'owner')],
        }),
      ).map(({ summary }) => summary),
    ).toEqual([
      'Cannot rename field "Profile.ownerName" to "Profile.owner": the field is stored in documents on one side of the statement only',
    ]);
  });

  it('refuses a statement on a collection whose control policy is not managed', () => {
    const to = contract(
      'to',
      { User: { collection: 'users', fields: ['_id', 'name'] } },
      { users: { unique: ['name'], required: ['name'], control: 'external' } },
    );
    expect(
      refusal(
        plan({
          from: profiles,
          to,
          schema: profilesSchema,
          statements: [renameModel('Profile', 'User')],
        }),
      ).map(({ summary }) => summary),
    ).toEqual([
      'Cannot rename model "Profile" to "User": collection "users" has control policy "external"',
    ]);
  });

  it("refuses a field rename when the model's collection changes and the plan does not rename it", () => {
    const statement = renameField('Profile', 'name', 'Profile', 'fullName');
    const from = contract(
      'from',
      { Profile: { collection: 'profiles', fields: ['_id', 'name'] } },
      { profiles: { unique: ['name'], required: ['name'], control: 'tolerated' } },
    );
    const to = contract(
      'to',
      { Profile: { collection: 'users', fields: ['_id', 'fullName'] } },
      { users: {} },
    );
    expect(plan({ from, to, schema: profilesSchema, statements: [statement] })).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename field "Profile.name" to "Profile.fullName": the model\'s collection changes from "profiles" to "users", and the plan does not rename it',
          why: 'The plan renames a collection only when every model stored in it moves to the same new collection, its control policy is "managed" in both contracts, and the schema being planned from has the old collection and not the new one, so the field would be renamed in a collection the destination does not store the model in. Leave out this statement.',
          refusedStatement: statement,
        },
      ],
    });
  });

  it('refuses a field rename of a model that changes its name and collection with no model statement, and says which to add', () => {
    expect(
      refusal(
        plan({
          from: profiles,
          to: contract(
            'to',
            { User: { collection: 'users', fields: ['_id', 'fullName'] } },
            { users: {} },
          ),
          schema: profilesSchema,
          statements: [renameField('Profile', 'name', 'User', 'fullName')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename field "User.name" to "User.fullName": the model\'s collection changes from "profiles" to "users", and the plan does not rename it',
        why: 'Add --rename Profile:User before this statement, so the collection is renamed with its documents.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, a variant rename that keeps its discriminator value', () => {
  const tasks = (seed: string, variant: string, value: string) =>
    contract(
      seed,
      {
        Task: {
          collection: 'tasks',
          fields: ['_id', 'type'],
          discriminator: 'type',
          variants: { [variant]: value, Feature: 'feature' },
        },
        [variant]: { collection: 'tasks', fields: ['score'], base: 'Task' },
        Feature: { collection: 'tasks', fields: ['priority'], base: 'Task' },
      },
      { tasks: {} },
    );

  it('plans nothing when the value is kept', () => {
    const keep = tasks('to', 'Defect', 'bug');
    const result = plan({
      from: tasks('from', 'Bug', 'bug'),
      to: keep,
      schema: [schemaCollection('tasks')],
      statements: [renameModel('Bug', 'Defect')],
    });
    expect(
      result.kind === 'success' ? result.appliedStatements[0]?.operationIndexes : result,
    ).toEqual([]);
  });
});

describe('MongoMigrationPlanner, a field of a time-series collection', () => {
  const readings = (seed: string, fields: readonly string[]) =>
    contract(
      seed,
      { Reading: { collection: 'readings', fields: ['_id', 'at', ...fields] } },
      { readings: { timeField: 'at' } },
    );
  const schema = [schemaCollection('readings', { timeseries: true })];

  it('cannot be renamed, and the refusal says to keep its stored name', () => {
    expect(
      refusal(
        plan({
          from: readings('from', ['value']),
          to: readings('to', ['reading']),
          schema,
          statements: [renameField('Reading', 'value', 'Reading', 'reading')],
        }),
      ),
    ).toEqual([
      {
        kind: 'statementRefused',
        summary:
          'Cannot rename field "Reading.value" to "Reading.reading": collection "readings" is a time-series collection',
        why: 'MongoDB updates the documents of a time-series collection only through its metaField, so a statement cannot move the values of a field in them. Keep the stored name: store the field as "value" (with @map("value") in PSL), then run this command again without this statement.',
      },
    ]);
  });

  it('plans nothing once the stored name is kept, as the refusal says', () => {
    expect(
      plan({ from: readings('from', ['value']), to: readings('to', ['value']), schema }).kind,
    ).toBe('success');
  });

  it('cannot be removed, and the refusal says to keep it', () => {
    expect(
      refusal(plan({ from: readings('from', ['value']), to: readings('to', []), schema })),
    ).toEqual([
      {
        kind: 'fieldRemovalRefused',
        summary:
          'Cannot remove field "value" from collection "readings": it is a time-series collection',
        why: 'MongoDB updates the documents of a time-series collection only through its metaField, so the field cannot be removed from the documents that hold it. Keep the field in the contract, as an optional field if new documents leave it out, then run this command again.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, a model with no collection', () => {
  it('refuses a rename of a model whose documents no collection holds, naming the model', () => {
    const orphan = (seed: string, model: string) =>
      contract(seed, { [model]: { fields: ['_id', 'name'] } }, {});

    expect(
      refusal(
        plan({
          from: orphan('from', 'Orphan'),
          to: orphan('to', 'Lonely'),
          schema: [],
          statements: [renameModel('Orphan', 'Lonely')],
        }),
      ).map(({ summary }) => summary),
    ).toEqual([
      'Cannot rename model "Orphan" to "Lonely": model "Orphan" names no collection, and neither does a base or an owner',
    ]);
  });
});
