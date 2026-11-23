import { describe, expect, it } from 'vitest';
import {
  contract,
  type ModelSpec,
  NS,
  plan,
  planned,
  renameModel,
  schemaCollection,
  sharedJsonSchema,
} from './mongo-statement-fixtures';

/** Tasks discriminated by `type`, `Bug` and `Epic` stored in the base's collection unless given their own. */
function tasks(
  seed: string,
  options: {
    readonly collection?: string;
    readonly bug?: Partial<ModelSpec> & { readonly name?: string };
    readonly collections?: readonly string[];
  } = {},
) {
  const collection = options.collection ?? 'tasks';
  const bug = options.bug?.name ?? 'Bug';
  return contract(
    seed,
    {
      Task: {
        collection,
        fields: ['_id', 'type'],
        discriminator: 'type',
        variants: { [bug]: 'bug', Epic: 'epic' },
      },
      [bug]: { fields: ['severity'], base: 'Task', ...options.bug },
      Epic: { fields: ['scope'], base: 'Task' },
    },
    Object.fromEntries([collection, ...(options.collections ?? [])].map((name) => [name, {}])),
  );
}

const liveTasks = [schemaCollection('tasks')];

const LEAVE_OUT_SHARED = (moving: string) =>
  `Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about ${moving} offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data.`;

describe('MongoMigrationPlanner, a collection that variants share with their base', () => {
  it('renames the collection once when the base changes @@map and the variants follow', () => {
    expect(
      planned(
        plan({
          from: tasks('from'),
          to: tasks('to', { collection: 'work_items' }),
          schema: liveTasks,
        }),
      ),
    ).toEqual({
      labels: ['Rename collection tasks to work_items'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('renames the collection once for a base rename statement whose variants follow by their names', () => {
    const to = contract(
      'to',
      {
        WorkItem: {
          collection: 'work_items',
          fields: ['_id', 'type'],
          discriminator: 'type',
          variants: { Bug: 'bug', Epic: 'epic' },
        },
        Bug: { fields: ['severity'], base: 'WorkItem' },
        Epic: { fields: ['scope'], base: 'WorkItem' },
      },
      { work_items: {} },
    );
    expect(
      planned(
        plan({
          from: tasks('from'),
          to,
          schema: liveTasks,
          statements: [renameModel('Task', 'WorkItem')],
        }),
      ),
    ).toEqual({
      labels: ['Rename collection tasks to work_items'],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('pairs a variant renamed without a statement by its storage once the collection is renamed', () => {
    expect(
      planned(
        plan({
          from: tasks('from'),
          to: tasks('to', { collection: 'work_items', bug: { name: 'Defect' } }),
          schema: liveTasks,
        }),
      ),
    ).toEqual({
      labels: ['Rename collection tasks to work_items'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('renames the collection when the destination removes a variant, and deletes and asks about its documents', () => {
    const to = contract(
      'to',
      {
        Task: {
          collection: 'work_items',
          fields: ['_id', 'type'],
          discriminator: 'type',
          variants: { Epic: 'epic' },
        },
        Epic: { fields: ['scope'], base: 'Task' },
      },
      { work_items: {} },
    );
    const deleted = 'Delete the documents of collection work_items whose type is "bug"';
    expect(planned(plan({ from: tasks('from'), to, schema: liveTasks }))).toEqual({
      labels: ['Rename collection tasks to work_items', deleted],
      classes: ['widening', 'destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'model', namespaceId: NS, model: 'Bug' },
          loss: 'drop',
          label: deleted,
        },
      ],
    });
  });

  it('renames nothing when a variant gains a collection of its own', () => {
    const result = plan({
      from: tasks('from'),
      to: tasks('to', { bug: { collection: 'bugs' }, collections: ['bugs'] }),
      schema: liveTasks,
    });
    expect(planned(result)).toEqual({
      labels: ['Create collection bugs'],
      classes: ['additive'],
      applied: [],
      dataLoss: [],
    });
  });

  it("renames nothing when a variant's own collection folds back into its base's", () => {
    const result = plan({
      from: tasks('from', { bug: { collection: 'bugs' }, collections: ['bugs'] }),
      to: tasks('to'),
      schema: [...liveTasks, schemaCollection('bugs')],
    });
    expect(planned(result)).toEqual({
      labels: ['Drop collection bugs'],
      classes: ['destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'model', namespaceId: NS, model: 'Bug' },
          loss: 'drop',
          label: 'Drop collection bugs',
        },
      ],
    });
  });

  it("refuses a model rename statement that would move the documents of the other models in the variant's collection", () => {
    const statement = renameModel('Bug', 'Defect');
    const result = plan({
      from: tasks('from'),
      to: tasks('to', {
        bug: { name: 'Defect', collection: 'defects' },
        collections: ['defects'],
      }),
      schema: liveTasks,
      statements: [statement],
    });
    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "Bug" to "Defect": collection "tasks" also stores models "Task" and "Epic"',
          why: `A collection rename moves every document of the collection, and the documents of models "Task" and "Epic" do not move to collection "defects". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write. ${LEAVE_OUT_SHARED('model "Bug"')} To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "Bug" into collection "defects" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`,
          refusedStatement: statement,
        },
      ],
    });
  });

  it('refuses a model rename statement whose new collection already stores the documents of other models', () => {
    const statement = renameModel('Bug', 'Defect');
    const result = plan({
      from: tasks('from', { bug: { collection: 'bugs' }, collections: ['bugs'] }),
      to: tasks('to', { bug: { name: 'Defect' } }),
      schema: [...liveTasks, schemaCollection('bugs')],
      statements: [statement],
    });
    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "Bug" to "Defect": collection "tasks" also stores models "Task" and "Epic", whose documents are not in collection "bugs"',
          why: `A collection rename moves the documents of one collection, and collection "tasks" would also store the documents of models "Task" and "Epic". Moving the documents of two collections into one is a data migration, which a plan does not write. ${LEAVE_OUT_SHARED('model "Bug"')} To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "Bug", and those of models "Task" and "Epic" that collection "tasks" does not already hold, into collection "tasks" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`,
          refusedStatement: statement,
        },
      ],
    });
  });
});

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

const liveUsers = [
  schemaCollection('users', { jsonSchema: sharedJsonSchema(['level'], ['level']) }),
];

describe('MongoMigrationPlanner, a collection that several root models share', () => {
  it('renames nothing when one of the root models moves to another collection', () => {
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

  it('renames nothing when two root models of their own collections move to one new collection', () => {
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
        },
        {
          operationIndex: 2,
          subject: { kind: 'model', namespaceId: NS, model: 'User' },
          loss: 'drop',
          label: 'Drop collection users',
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

  it('renames nothing when the destination removes one root model and moves the other, and asks about the drop', () => {
    expect(
      planned(
        plan({
          from: shared('from', { admin: 'users', user: 'users' }),
          to: userAlone('to', 'members'),
          schema: liveUsers,
        }),
      ),
    ).toEqual({
      labels: ['Create collection members', 'Drop collection users'],
      classes: ['additive', 'destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'model', namespaceId: NS, model: 'Admin' },
          loss: 'drop',
          label: 'Drop collection users',
        },
      ],
    });
  });

  it('refuses a model rename statement on a collection whose other root model the destination removes', () => {
    const statement = renameModel('User', 'Member');
    expect(
      plan({
        from: shared('from', { admin: 'users', user: 'users' }),
        to: userAlone('to', 'members', 'Member'),
        schema: liveUsers,
        statements: [statement],
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "User" to "Member": collection "users" also stores model "Admin", which the destination removes',
          why: 'A collection rename moves every document of the collection, and no discriminator tells the documents of model "Admin" apart from those of model "User", so they would move to collection "members" as documents of model "User". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then drops collection "users" and asks about it, and --delete answers that question and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "User" into collection "members" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
          refusedStatement: statement,
        },
      ],
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
          why: `A collection rename moves every document of the collection, and the documents of model "Admin" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write. ${LEAVE_OUT_SHARED('model "User"')} To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "User" into collection "members" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`,
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
          why: 'The stored name of field "User.level" changes from "level" to "rank". Collection "people" stores several models and no discriminator tells their documents apart, so renaming the field would rename it in the documents of "Admin" too. To change it, move the models to separate collections, or carry out the change yourself, with a filter that selects only their documents, in a dataTransform operation of the migration.ts that migration plan writes or in mongosh.',
        },
      ],
    });
  });
});
