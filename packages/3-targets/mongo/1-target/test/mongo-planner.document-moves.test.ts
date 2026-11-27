import { describe, expect, it } from 'vitest';
import {
  contract,
  plan,
  planned,
  refusal,
  renameField,
  renameModel,
  schemaCollection,
  sharedJsonSchema,
} from './mongo-statement-fixtures';

const ADMIN = { collection: 'users', fields: ['_id', 'admin'] };
const USER = { collection: 'users', fields: ['_id', 'user'] };
const GUEST_ONLY = { required: ['guest'] };
const GUEST_OR_MEMBER = { jsonSchema: sharedJsonSchema(['guest'], ['user']) };

function whyOf(result: ReturnType<typeof plan>): string {
  const [conflict] = refusal(result);
  return conflict?.why ?? '';
}

describe('MongoMigrationPlanner, the route that moves documents out of a collection they share', () => {
  it('skips validation in the copy when the plan widens the validator of a target that exists', () => {
    const from = contract(
      'from',
      { Admin: ADMIN, User: USER, Guest: { collection: 'members', fields: ['_id', 'guest'] } },
      { users: {}, members: GUEST_ONLY },
    );
    const to = contract(
      'to',
      {
        Admin: { ...ADMIN, storedAs: { admin: 'role' } },
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: GUEST_OR_MEMBER },
    );
    const schema = [schemaCollection('users'), schemaCollection('members', GUEST_ONLY)];
    expect({
      leftOut: planned(plan({ from, to, schema })).labels,
      why: whyOf(plan({ from, to, schema, statements: [renameModel('User', 'Member')] })),
    }).toEqual({
      leftOut: [
        'Rename field admin to role in collection users',
        'Update validator on members (added: user)',
      ],
      why: expect.stringContaining(
        'Plan the change without --rename User:Member.\n\nAt the start of the operations of the migration.ts it writes, before the plan\'s own operations on collection "users", add a dataTransform. Its run copies the documents of model "User" into collection "members":\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "members" } },\n  ], { bypassDocumentValidation: true })\n\nAfter it, add the operation that deletes the documents of model "User" from collection "users":\n\n  deleteDocuments({ collection: "users", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "users", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "User" stores. If it stores none, no field tells its documents apart: select them by their _id values instead. The copy skips document validation because collection "members" still has its old validator; the later validator update on "members" checks the moved documents.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nStop writes to each collection the documents move out of until the apply ends: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, re-runs included: a document written there after the check could hold the _id of a document that moves.\n\nIf the apply stops, fix what stopped it and run db migrate again. If the validator update on "members" stops it, the moved documents are in collection "members": fix them there.',
      ),
    });
  });

  describe('a target another collection is renamed to', () => {
    const from = contract(
      'from',
      { Admin: ADMIN, User: USER, Guest: { collection: 'guests', fields: ['_id', 'guest'] } },
      { users: {}, guests: GUEST_ONLY },
    );
    const schema = [schemaCollection('users'), schemaCollection('guests', GUEST_ONLY)];

    it('puts the move right after the rename', () => {
      const to = contract(
        'to',
        {
          Admin: ADMIN,
          Member: { collection: 'members', fields: ['_id', 'user'] },
          Guest: { collection: 'members', fields: ['_id', 'guest'] },
        },
        { users: {}, members: GUEST_OR_MEMBER },
      );
      expect({
        leftOut: planned(plan({ from, to, schema })).labels,
        why: whyOf(plan({ from, to, schema, statements: [renameModel('User', 'Member')] })),
      }).toEqual({
        leftOut: [
          'Rename collection guests to members',
          'Update validator on members (added: user)',
        ],
        why: expect.stringContaining(
          'Plan the change without --rename User:Member.\n\nIn the operations of the migration.ts it writes, right after the rename of collection "guests" to "members" and before the plan\'s own operations on collection "users", add a dataTransform. Its run copies the documents of model "User" into collection "members":\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "members" } },\n  ], { bypassDocumentValidation: true })',
        ),
      });
    });

    it("puts the move right after the rename when the target's rewrite cannot reach the moved documents", () => {
      const to = contract(
        'to',
        {
          Admin: ADMIN,
          Member: { collection: 'members', fields: ['_id', 'user'] },
          Guest: { collection: 'members', fields: ['_id', 'guest'], storedAs: { guest: 'name' } },
        },
        { users: {}, members: { jsonSchema: sharedJsonSchema(['name'], ['user']) } },
      );
      expect({
        leftOut: planned(plan({ from, to, schema })).labels,
        why: whyOf(plan({ from, to, schema, statements: [renameModel('User', 'Member')] })),
      }).toEqual({
        leftOut: [
          'Rename collection guests to members',
          'Rename field guest to name in collection members',
          'Update validator on members (added: name, user; removed: guest)',
        ],
        why: expect.stringContaining(
          'With migration plan, keep the documents by moving them in the migration that plan writes. Plan the change without --rename User:Member.\n\nIn the operations of the migration.ts it writes, right after the rename of collection "guests" to "members" and before the plan\'s own operations on collection "users", add a dataTransform.',
        ),
      });
    });
  });

  it("writes the moving model's new stored names in the copy", () => {
    const from = contract(
      'from',
      { Admin: ADMIN, User: { collection: 'users', fields: ['_id', 'name'] } },
      { users: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'name'], storedAs: { name: 'fullName' } },
      },
      { users: {}, members: {} },
    );
    expect(
      whyOf(
        plan({
          from,
          to,
          schema: [schemaCollection('users')],
          statements: [renameModel('User', 'Member')],
        }),
      ),
    ).toContain(
      '  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $set: { fullName: "$name" } },\n    { $unset: ["name"] },\n    { $merge: { into: "members" } },\n  ])',
    );
  });

  it('writes a stated field rename of the moving model in the copy, and names that statement among those to leave out', () => {
    const from = contract(
      'from',
      { Admin: ADMIN, User: { collection: 'users', fields: ['_id', 'user', 'name'] } },
      { users: {} },
    );
    const to = contract(
      'to',
      { Admin: ADMIN, Member: { collection: 'members', fields: ['_id', 'user', 'fullName'] } },
      { users: {}, members: {} },
    );
    const why = whyOf(
      plan({
        from,
        to,
        schema: [schemaCollection('users')],
        statements: [
          renameModel('User', 'Member'),
          renameField('User', 'name', 'Member', 'fullName'),
        ],
      }),
    );
    expect({
      leaveOut: why.startsWith(
        'A collection rename moves every document of the collection, and the documents of model "Admin" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.\n\nLeave out --rename User:Member and --rename Member.name:Member.fullName to plan the change without moving them.',
      ),
      plan: why.includes(
        'Plan the change without --rename User:Member and --rename Member.name:Member.fullName.',
      ),
      copy: why.includes(
        '  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $set: { fullName: "$name" } },\n    { $unset: ["name"] },\n    { $merge: { into: "members" } },\n  ])',
      ),
    }).toEqual({ leaveOut: true, plan: true, copy: true });
  });

  it('drops in the copy the fields the destination model does not store, and says so', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'user', 'extra'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: GUEST_ONLY },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: GUEST_OR_MEMBER },
    );
    const why = whyOf(
      plan({
        from,
        to,
        schema: [schemaCollection('users'), schemaCollection('members', GUEST_ONLY)],
        statements: [renameModel('User', 'Member')],
      }),
    );
    expect({
      copy: why.includes(
        '  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $unset: ["extra"] },\n    { $merge: { into: "members" } },\n  ], { bypassDocumentValidation: true })',
      ),
      drops: why.includes(
        'Its $unset stage deletes field "extra" and its values from the moved documents, since the model they become does not store it.',
      ),
    }).toEqual({ copy: true, drops: true });
  });

  it('leaves out every statement of a change that moves several models, and gives each its own copy', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        A: { collection: 'users', fields: ['_id', 'a'] },
        B: { collection: 'users', fields: ['_id', 'b'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        A2: { collection: 'members', fields: ['_id', 'a'], storedAs: { a: 'x' } },
        B2: { collection: 'members', fields: ['_id', 'b'], storedAs: { b: 'x' } },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
      },
      { users: {}, members: {} },
    );
    const why = whyOf(
      plan({
        from,
        to,
        schema: [schemaCollection('users'), schemaCollection('members')],
        statements: [renameModel('A', 'A2'), renameModel('B', 'B2')],
      }),
    );
    expect(why).toContain(
      'Leave out --rename A:A2 and --rename B:B2 to plan the change without moving them. Models "A" and "B" are then removed and nothing is asked, since nothing is deleted. Their documents stay in collection "users", where model "Admin" still reads them. Models "A2" and "B2" read the documents of model "Guest" already stored in their collection, since no discriminator tells them apart. If the new validator of collection "users" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there.\n\nWith migration plan, keep the documents by moving them in the migration that plan writes. Plan the change without --rename A:A2 and --rename B:B2.\n\nAt the start of the operations of the migration.ts it writes, before the plan\'s own operations on collection "users", add one dataTransform for each group of models whose documents change alike on the way into collection "members". The run of each is one of these copies:\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only the documents of model "A"> },\n    { $set: { x: "$a" } },\n    { $unset: ["a"] },\n    { $merge: { into: "members" } },\n  ])\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only the documents of model "B"> },\n    { $set: { x: "$b" } },\n    { $unset: ["b"] },\n    { $merge: { into: "members" } },\n  ])\n\nAfter them, add the operation that deletes the documents of models "A" and "B" from collection "users":\n\n  deleteDocuments({ collection: "users", filter: <a filter that selects the documents of all of them> })\n\nEach copy\'s filter must select only the documents of its own models, apart from those of the other models that move and from the other documents of collection "users", which can hold the same values in the fields they share, a discriminator value among them. Filter each copy by a field only its models store. If they store none, no field tells their documents apart: select them by their _id values instead.\n\nBoth dataTransforms go in that one migration.ts. Run it to emit its ops.json, and apply it once with db migrate.\n\nStop writes to each collection the documents move out of until the apply ends: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, re-runs included: a document written there after the check could hold the _id of a document that moves.\n\nIf the apply stops, fix what stopped it and run db migrate again.',
    );
  });

  it('sets the discriminator value in the copy when the moving model becomes a variant', () => {
    const person = {
      collection: 'people',
      fields: ['_id', 'kind'],
      discriminator: 'kind',
      variants: { Staff: 'staff' },
    };
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: USER,
        Person: person,
        Staff: { fields: ['sev'], base: 'Person' },
      },
      { users: {}, people: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Person: { ...person, variants: { Staff: 'staff', Member: 'member' } },
        Staff: { fields: ['sev'], base: 'Person' },
        Member: { fields: ['user'], base: 'Person' },
      },
      { users: {}, people: {} },
    );
    const why = whyOf(
      plan({
        from,
        to,
        schema: [schemaCollection('users'), schemaCollection('people')],
        statements: [renameModel('User', 'Member')],
      }),
    );
    expect({
      copy: why.includes(
        '  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $set: { kind: { $literal: "member" } } },\n    { $merge: { into: "people" } },\n  ])',
      ),
      readsPerson: why.includes('reads the documents of model "Person"'),
    }).toEqual({ copy: true, readsPerson: false });
  });

  it('gives no move route when the plan without the statement is refused as well', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'name'] },
        Guest: { collection: 'members', fields: ['_id', 'guest', 'name'] },
      },
      { users: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'name'] },
        Guest: {
          collection: 'members',
          fields: ['_id', 'guest', 'name'],
          storedAs: { name: 'fullName' },
        },
      },
      { users: {}, members: {} },
    );
    const why = whyOf(
      plan({
        from,
        to,
        schema: [schemaCollection('users'), schemaCollection('members')],
        statements: [renameModel('User', 'Member')],
      }),
    );
    expect({
      refusedToo: why.includes(
        'Planned without it, the change is refused for another reason as well: "',
      ),
      move: why.includes('rawAggregate'),
    }).toEqual({ refusedToo: true, move: false });
  });

  it('reads the source under its new name when the plan without the statement renames it', () => {
    const from = contract('from', { Admin: ADMIN, User: USER }, { users: {} });
    const to = contract(
      'to',
      {
        Admin: { ...ADMIN, collection: 'admins' },
        Member: { collection: 'members', fields: ['_id', 'user'] },
      },
      { admins: {}, members: {} },
    );
    const schema = [schemaCollection('users')];
    expect({
      leftOut: planned(plan({ from, to, schema })).labels,
      why: whyOf(plan({ from, to, schema, statements: [renameModel('User', 'Member')] })),
    }).toEqual({
      leftOut: ['Rename collection users to admins', 'Create collection members'],
      why: expect.stringContaining(
        'right after the creation of collection "members" and before the plan\'s own operations on collection "admins", add a dataTransform. Its run copies the documents of model "User" into collection "members":\n\n  rawAggregate("admins", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "members" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "User" from collection "admins":\n\n  deleteDocuments({ collection: "admins", filter: <the same filter> })',
      ),
    });
  });
});

describe('MongoMigrationPlanner, the route that moves a root model out before a variant change', () => {
  it('skips validation in the copy when the plan widens the validator of a target that exists', () => {
    const task = {
      collection: 'tasks',
      fields: ['_id', 'type'],
      discriminator: 'type',
      variants: { Bug: 'bug' },
    };
    const from = contract(
      'from',
      {
        Admin: { collection: 'tasks', fields: ['_id', 'type'] },
        Task: { ...task, variants: { Bug: 'bug', Feat: 'feat' } },
        Bug: { fields: ['sev'], base: 'Task' },
        Feat: { fields: ['area'], base: 'Task' },
        Guest: { collection: 'people', fields: ['_id', 'guest'] },
      },
      { tasks: {}, people: GUEST_ONLY },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'people', fields: ['_id', 'type'] },
        Task: { ...task, variants: { Feat: 'feat' } },
        Feat: { fields: ['area'], base: 'Task' },
        Guest: { collection: 'people', fields: ['_id', 'guest'] },
      },
      { tasks: {}, people: { jsonSchema: sharedJsonSchema(['guest'], ['type']) } },
    );
    expect(
      whyOf(
        plan({
          from,
          to,
          schema: [schemaCollection('tasks'), schemaCollection('people', GUEST_ONLY)],
        }),
      ),
    ).toContain(
      'At the start of the operations of the migration.ts it writes, before the plan\'s own operations on collection "tasks", add a dataTransform. Its run copies the documents of model "Admin" into collection "people":\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "people" } },\n  ], { bypassDocumentValidation: true })\n\nAfter it, add the operation that deletes the documents of model "Admin" from collection "tasks":\n\n  deleteDocuments({ collection: "tasks", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "tasks", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "Admin" stores. If it stores none, no field tells its documents apart: select them by their _id values instead. The copy skips document validation because collection "people" still has its old validator; the later validator update on "people" checks the moved documents.',
    );
  });

  describe('two models that move to one target', () => {
    const task = {
      collection: 'tasks',
      fields: ['_id', 'type'],
      discriminator: 'type',
      variants: { Bug: 'bug', Feat: 'feat' },
    };
    const taskModels = {
      Bug: { fields: ['sev'], base: 'Task' },
      Feat: { fields: ['area'], base: 'Task' },
    };
    const remaining = {
      Task: { ...task, variants: { Feat: 'feat' } },
      Feat: { fields: ['area'], base: 'Task' },
    };

    it('gives each model its own copy when one renames a field the other keeps', () => {
      const from = contract(
        'from',
        {
          Admin: { collection: 'tasks', fields: ['_id', 'type', 'n'] },
          Staff: { collection: 'tasks', fields: ['_id', 'type', 'n'] },
          Task: task,
          ...taskModels,
        },
        { tasks: {} },
      );
      const to = contract(
        'to',
        {
          Admin: { collection: 'people', fields: ['_id', 'type', 'n'], storedAs: { n: 'name' } },
          Staff: { collection: 'people', fields: ['_id', 'type', 'n'] },
          ...remaining,
        },
        { tasks: {}, people: {} },
      );
      expect(whyOf(plan({ from, to, schema: [schemaCollection('tasks')] }))).toContain(
        'add one dataTransform for each group of models whose documents change alike on the way into collection "people". The run of each is one of these copies:\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only the documents of model "Admin"> },\n    { $set: { name: "$n" } },\n    { $unset: ["n"] },\n    { $merge: { into: "people" } },\n  ])\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only the documents of model "Staff"> },\n    { $merge: { into: "people" } },\n  ])\n\nAfter them, add the operation that deletes the documents of models "Admin" and "Staff" from collection "tasks":\n\n  deleteDocuments({ collection: "tasks", filter: <a filter that selects the documents of all of them> })',
      );
    });

    it('gives each model its own copy when their fields move to the same stored name', () => {
      const from = contract(
        'from',
        {
          Admin: { collection: 'tasks', fields: ['_id', 'type', 'a'] },
          Staff: { collection: 'tasks', fields: ['_id', 'type', 'b'] },
          Task: task,
          ...taskModels,
        },
        { tasks: {} },
      );
      const to = contract(
        'to',
        {
          Admin: { collection: 'people', fields: ['_id', 'type', 'a'], storedAs: { a: 'x' } },
          Staff: { collection: 'people', fields: ['_id', 'type', 'b'], storedAs: { b: 'x' } },
          ...remaining,
        },
        { tasks: {}, people: {} },
      );
      expect(whyOf(plan({ from, to, schema: [schemaCollection('tasks')] }))).toContain(
        ':\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only the documents of model "Admin"> },\n    { $set: { x: "$a" } },\n    { $unset: ["a"] },\n    { $merge: { into: "people" } },\n  ])\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only the documents of model "Staff"> },\n    { $set: { x: "$b" } },\n    { $unset: ["b"] },\n    { $merge: { into: "people" } },\n  ])\n\n',
      );
    });
  });
});
