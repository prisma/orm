import type { ControlPolicy } from '@internal/contract/types';
import { describe, expect, it } from 'vitest';
import {
  contract,
  NS,
  plan,
  planned,
  profiles,
  profilesSchema,
  renameField,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

describe('MongoMigrationPlanner, field statements', () => {
  const fullName = contract(
    'to',
    { Profile: { collection: 'profiles', fields: ['_id', 'fullName'] } },
    { profiles: { unique: ['fullName'], required: ['fullName'] } },
  );

  describe('a field stored under another name', () => {
    const displayName = (seed: string, field: string, storedAs: string) =>
      contract(
        seed,
        {
          Profile: {
            collection: 'profiles',
            fields: ['id', field],
            storedAs: { id: '_id', [field]: storedAs },
          },
        },
        { profiles: { required: [storedAs] } },
      );
    const displayNameSchema = [schemaCollection('profiles', { required: ['display_name'] })];

    it('plans nothing for a rename that keeps the stored name', () => {
      expect(
        planned(
          plan({
            from: displayName('from', 'name', 'display_name'),
            to: displayName('to', 'title', 'display_name'),
            schema: displayNameSchema,
            statements: [renameField('Profile', 'name', 'Profile', 'title')],
          }),
        ),
      ).toEqual({ labels: [], classes: [], applied: [[]], dataLoss: [] });
    });

    it('renames the stored field when the rename changes the stored name', () => {
      expect(
        planned(
          plan({
            from: displayName('from', 'name', 'display_name'),
            to: displayName('to', 'title', 'title'),
            schema: displayNameSchema,
            statements: [renameField('Profile', 'name', 'Profile', 'title')],
          }),
        ),
      ).toEqual({
        labels: [
          'Rename field display_name to title in collection profiles',
          'Update validator on profiles (added: title; removed: display_name)',
        ],
        classes: ['widening', 'widening'],
        applied: [[0]],
        dataLoss: [],
      });
    });

    it('plans nothing and loses nothing when a field is renamed without a statement and keeps its stored name', () => {
      expect(
        planned(
          plan({
            from: displayName('from', 'name', 'display_name'),
            to: displayName('to', 'title', 'display_name'),
            schema: displayNameSchema,
          }),
        ),
      ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
    });

    it('asks about the field whose stored name changes without a statement, by its own name', () => {
      expect(
        planned(
          plan({
            from: displayName('from', 'name', 'display_name'),
            to: displayName('to', 'name', 'full_name'),
            schema: displayNameSchema,
          }),
        ).dataLoss,
      ).toEqual([
        expect.objectContaining({
          subject: { kind: 'field', namespaceId: NS, model: 'Profile', field: 'name' },
        }),
      ]);
    });

    it('plans nothing from a contract that named the document id _id to one that names it id', () => {
      const rewrittenSnapshot = contract(
        'from',
        { Profile: { collection: 'profiles', fields: ['_id', 'first_name'] } },
        { profiles: { required: ['first_name'] } },
      );
      const reEmitted = contract(
        'to',
        {
          Profile: {
            collection: 'profiles',
            fields: ['id', 'firstName'],
            storedAs: { id: '_id', firstName: 'first_name' },
          },
        },
        { profiles: { required: ['first_name'] } },
      );
      expect(
        planned(
          plan({
            from: rewrittenSnapshot,
            to: reEmitted,
            schema: [schemaCollection('profiles', { required: ['first_name'] })],
          }),
        ),
      ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
    });
  });

  it('renames the field between the index drop and the index create, before the validator update', () => {
    expect(
      planned(
        plan({
          from: profiles,
          to: fullName,
          schema: profilesSchema,
          statements: [renameField('Profile', 'name', 'Profile', 'fullName')],
        }),
      ),
    ).toEqual({
      labels: [
        'Drop index name_1 on profiles (name:1)',
        'Rename field name to fullName in collection profiles',
        'Create index fullName_1 on profiles (fullName:1)',
        'Update validator on profiles (added: fullName; removed: name)',
      ],
      classes: ['widening', 'widening', 'additive', 'widening'],
      applied: [[1]],
      dataLoss: [],
    });
  });

  it('renames the collection first, then the field in the renamed collection', () => {
    const to = contract(
      'to',
      { User: { collection: 'users', fields: ['_id', 'fullName'] } },
      { users: { unique: ['fullName'], required: ['fullName'] } },
    );
    expect(
      planned(
        plan({
          from: profiles,
          to,
          schema: profilesSchema,
          statements: [
            renameModel('Profile', 'User'),
            renameField('Profile', 'name', 'User', 'fullName'),
          ],
        }),
      ),
    ).toMatchObject({
      labels: [
        'Rename collection profiles to users',
        'Drop index name_1 on users (name:1)',
        'Rename field name to fullName in collection users',
        'Create index fullName_1 on users (fullName:1)',
        'Update validator on users (added: fullName; removed: name)',
      ],
      applied: [[0], [2]],
      dataLoss: [],
    });
  });

  it("renames a variant's field only in that variant's documents", () => {
    const tasks = (bugField: string) =>
      contract(
        bugField,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type'],
            discriminator: 'type',
            variants: { Bug: 'bug', Feature: 'feature' },
          },
          Bug: { collection: 'tasks', fields: [bugField], base: 'Task' },
          Feature: { collection: 'tasks', fields: ['score'], base: 'Task' },
        },
        { tasks: {} },
      );
    expect(
      planned(
        plan({
          from: tasks('score'),
          to: tasks('severity'),
          schema: [schemaCollection('tasks')],
          statements: [renameField('Bug', 'score', 'Bug', 'severity')],
        }),
      ).labels,
    ).toEqual([
      'Rename field score to severity in collection tasks in documents whose type is "bug"',
    ]);
  });

  it('plans nothing for a relation renamed to another relation, which documents do not store', () => {
    const withRelation = (relation: string) =>
      contract(
        relation,
        { Profile: { collection: 'profiles', fields: ['_id', 'name'], relations: [relation] } },
        { profiles: { unique: ['name'], required: ['name'] } },
      );
    expect(
      planned(
        plan({
          from: withRelation('owner'),
          to: withRelation('author'),
          schema: profilesSchema,
          statements: [renameField('Profile', 'owner', 'Profile', 'author')],
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [[]], dataLoss: [] });
  });
});

describe('MongoMigrationPlanner, removed fields', () => {
  const withoutName = contract(
    'to',
    { Profile: { collection: 'profiles', fields: ['_id', 'email'] } },
    { profiles: { required: ['email'] } },
  );
  const from = contract(
    'from',
    { Profile: { collection: 'profiles', fields: ['_id', 'email', 'name'] } },
    { profiles: { required: ['email', 'name'] } },
  );
  const schema = [schemaCollection('profiles', { required: ['email', 'name'] })];

  it('unsets a removed field from every document and reports the field as lost', () => {
    expect(planned(plan({ from, to: withoutName, schema }))).toEqual({
      labels: [
        'Remove field name from collection profiles',
        'Update validator on profiles (removed: name)',
      ],
      classes: ['destructive', 'widening'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: NS, model: 'Profile', field: 'name' },
          loss: 'drop',
          label: 'Remove field name from collection profiles',
        },
      ],
    });
  });

  it('names the field by its storage name when the origin contract is unknown', () => {
    expect(planned(plan({ from: null, to: withoutName, schema })).dataLoss).toEqual([
      {
        operationIndex: 0,
        subject: { kind: 'storage', name: 'profiles.name' },
        loss: 'drop',
        label: 'Remove field name from collection profiles',
      },
    ]);
  });

  it('unsets nothing when the collection is dropped', () => {
    const none = contract('to', {}, {});
    expect(planned(plan({ from, to: none, schema })).labels).toEqual(['Drop collection profiles']);
  });

  const tasks = (
    seed: string,
    baseFields: readonly string[],
    bugFields: readonly string[],
    featureFields: readonly string[],
  ) =>
    contract(
      seed,
      {
        Task: {
          collection: 'tasks',
          fields: ['_id', 'type', ...baseFields],
          discriminator: 'type',
          variants: { Bug: 'bug', Feature: 'feature' },
        },
        Bug: { collection: 'tasks', fields: bugFields, base: 'Task' },
        Feature: { collection: 'tasks', fields: featureFields, base: 'Task' },
      },
      { tasks: {} },
    );

  it('keeps a root field that becomes an embed relation stored under the same name', () => {
    const users = (seed: string, user: { fields: string[]; embeds?: Record<string, string> }) =>
      contract(seed, { User: { collection: 'users', ...user } }, { users: {} });
    expect(
      planned(
        plan({
          from: users('from', { fields: ['_id', 'notes'] }),
          to: users('to', { fields: ['_id'], embeds: { comments: 'notes' } }),
          schema: [schemaCollection('users')],
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
  });

  it('unsets a base field from the variants that do not keep it, counting a variant embed stored under its name as keeping it', () => {
    const tasks = (
      seed: string,
      taskFields: string[],
      bug: { fields: string[]; embeds?: Record<string, string> },
    ) =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type', ...taskFields],
            discriminator: 'type',
            variants: { Bug: 'bug', Feature: 'feature' },
          },
          Bug: { collection: 'tasks', base: 'Task', ...bug },
          Feature: { collection: 'tasks', fields: [], base: 'Task' },
        },
        { tasks: {} },
      );
    expect(
      planned(
        plan({
          from: tasks('from', ['notes'], { fields: [] }),
          to: tasks('to', [], { fields: [], embeds: { comments: 'notes' } }),
          schema: [schemaCollection('tasks')],
        }),
      ).labels,
    ).toEqual(['Remove field notes from collection tasks in documents whose type is not "bug"']);
  });

  it('keeps a variant field that becomes an embed relation stored under the same name', () => {
    const tasks = (seed: string, bug: { fields: string[]; embeds?: Record<string, string> }) =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type'],
            discriminator: 'type',
            variants: { Bug: 'bug' },
          },
          Bug: { collection: 'tasks', base: 'Task', ...bug },
        },
        { tasks: {} },
      );
    expect(
      planned(
        plan({
          from: tasks('from', { fields: ['notes'] }),
          to: tasks('to', { fields: [], embeds: { comments: 'notes' } }),
          schema: [schemaCollection('tasks')],
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
  });

  it("unsets a variant's removed field only from that variant's documents", () => {
    expect(
      planned(
        plan({
          from: tasks('from', [], ['score', 'severity'], ['score']),
          to: tasks('to', [], ['severity'], ['score']),
          schema: [schemaCollection('tasks')],
        }),
      ),
    ).toMatchObject({
      labels: ['Remove field score from collection tasks in documents whose type is "bug"'],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: NS, model: 'Bug', field: 'score' },
          loss: 'drop',
          label: 'Remove field score from collection tasks in documents whose type is "bug"',
        },
      ],
    });
  });

  it('unsets a base field moved to one variant from the documents of every other variant', () => {
    expect(
      planned(
        plan({
          from: tasks('from', ['note'], [], []),
          to: tasks('to', [], ['note'], []),
          schema: [schemaCollection('tasks')],
        }),
      ),
    ).toMatchObject({
      labels: ['Remove field note from collection tasks in documents whose type is not "bug"'],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: NS, model: 'Task', field: 'note' },
          loss: 'drop',
          label: 'Remove field note from collection tasks in documents whose type is not "bug"',
        },
      ],
    });
  });

  it('renames a base field moved to one variant only in the documents of the other variants', () => {
    expect(
      planned(
        plan({
          from: tasks('from', ['note'], [], []),
          to: tasks('to', ['remark'], ['note'], []),
          schema: [schemaCollection('tasks')],
          statements: [renameField('Task', 'note', 'Task', 'remark')],
        }),
      ),
    ).toMatchObject({
      labels: [
        'Rename field note to remark in collection tasks in documents whose type is not "bug"',
      ],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('keeps a variant field its base now stores', () => {
    expect(
      planned(
        plan({
          from: tasks('from', [], ['note'], []),
          to: tasks('to', ['note'], [], []),
          schema: [schemaCollection('tasks')],
        }),
      ).labels,
    ).toEqual([]);
  });

  it('unsets nothing without an origin contract when the destination collection has no validator', () => {
    const unvalidated = contract(
      'to',
      { Profile: { collection: 'profiles', fields: ['_id', 'email'] } },
      { profiles: {} },
    );
    expect(planned(plan({ from: null, to: unvalidated, schema })).labels).toEqual([
      'Remove validator on profiles',
    ]);
  });

  it('unsets nothing for a field a statement renames', () => {
    const fullName = contract(
      'to',
      { Profile: { collection: 'profiles', fields: ['_id', 'email', 'fullName'] } },
      { profiles: { required: ['email', 'fullName'] } },
    );
    expect(
      planned(
        plan({
          from,
          to: fullName,
          schema,
          statements: [renameField('Profile', 'name', 'Profile', 'fullName')],
        }),
      ).dataLoss,
    ).toEqual([]);
  });
});

describe('MongoMigrationPlanner, removed fields in a collection that is not managed', () => {
  const schema = [schemaCollection('auth_users', { required: ['email', 'legacy'] })];
  const authUsers = (seed: string, fields: readonly string[], control: ControlPolicy) =>
    contract(
      seed,
      { AuthUser: { collection: 'auth_users', fields: ['_id', ...fields] } },
      { auth_users: { required: fields, control } },
    );

  for (const control of ['external', 'observed', 'tolerated'] as const) {
    it(`unsets nothing and asks nothing when the collection is ${control}`, () => {
      const result = planned(
        plan({
          from: authUsers('from', ['email', 'legacy'], control),
          to: authUsers('to', ['email'], control),
          schema,
        }),
      );
      const noOrigin = planned(
        plan({ from: null, to: authUsers('to', ['email'], control), schema }),
      );
      expect({
        unsets: [...result.labels, ...noOrigin.labels].filter((label) =>
          label.startsWith('Remove field'),
        ),
        dataLoss: [...result.dataLoss, ...noOrigin.dataLoss],
      }).toEqual({ unsets: [], dataLoss: [] });
    });
  }
});
