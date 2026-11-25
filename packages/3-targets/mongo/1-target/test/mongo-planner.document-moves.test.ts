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
        'plan the change without this statement, and at the start of the operations of the migration.ts it writes, before any other operation on collection "users", add a dataTransform whose run copies the documents of model "User" into collection "members", such as rawAggregate("users", [{ $match: <a filter that selects only those documents> }, { $merge: { into: "members" } }], { bypassDocumentValidation: true }), and a deleteDocuments({ collection: "users", filter: <the same filter> }); then run that migration.ts to emit its ops.json, and apply it with db migrate. The copy skips document validation because collection "members" still has its old validator; the later validator update on "members" checks the moved documents. If that check stops the apply, the moved documents are in collection "members": fix them there and run db migrate again. This works only when',
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
          'plan the change without this statement, and in the operations of the migration.ts it writes, right after the rename of collection "guests" to "members" and before any other operation on collection "users", add a dataTransform whose run copies the documents of model "User" into collection "members", such as rawAggregate("users", [{ $match: <a filter that selects only those documents> }, { $merge: { into: "members" } }], { bypassDocumentValidation: true }),',
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
          'With migration plan, keep the documents by moving them in the migration that plan writes: plan the change without this statement, and in the operations of the migration.ts it writes, right after the rename of collection "guests" to "members" and before any other operation on collection "users", add a dataTransform',
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
      'rawAggregate("users", [{ $match: <a filter that selects only those documents> }, {"$set":{"fullName":"$name"}}, {"$unset":["name"]}, { $merge: { into: "members" } }])',
    );
  });

  it('writes a stated field rename of the moving model in the copy', () => {
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
    expect(
      whyOf(
        plan({
          from,
          to,
          schema: [schemaCollection('users')],
          statements: [
            renameModel('User', 'Member'),
            renameField('User', 'name', 'Member', 'fullName'),
          ],
        }),
      ),
    ).toContain(
      'rawAggregate("users", [{ $match: <a filter that selects only those documents> }, {"$set":{"fullName":"$name"}}, {"$unset":["name"]}, { $merge: { into: "members" } }])',
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
        'rawAggregate("users", [{ $match: <a filter that selects only those documents> }, {"$set":{"kind":{"$literal":"member"}}}, { $merge: { into: "people" } }])',
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
      refusedToo: why.endsWith(
        'Planned without this statement, the change is refused for another reason as well, which that refusal names.',
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
        'right after the creation of collection "members" and before any other operation on collection "admins", add a dataTransform whose run copies the documents of model "User" into collection "members", such as rawAggregate("admins", [{ $match: <a filter that selects only those documents> }, { $merge: { into: "members" } }]), and a deleteDocuments({ collection: "admins", filter: <the same filter> });',
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
      'at the start of the operations of the migration.ts it writes, before any other operation on collection "tasks", add a dataTransform whose run copies the documents of model "Admin" into collection "people", such as rawAggregate("tasks", [{ $match: <a filter that selects only those documents> }, { $merge: { into: "people" } }], { bypassDocumentValidation: true }), and a deleteDocuments({ collection: "tasks", filter: <the same filter> }); then run that migration.ts to emit its ops.json, and apply it with db migrate. The copy skips document validation because collection "people" still has its old validator; the later validator update on "people" checks the moved documents.',
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
        'add a dataTransform whose run copies the documents of models "Admin" and "Staff" into collection "people", one copy for each group of models whose documents change alike on the way, such as rawAggregate("tasks", [{ $match: <a filter that selects only the documents of model "Admin"> }, {"$set":{"name":"$n"}}, {"$unset":["n"]}, { $merge: { into: "people" } }]) for model "Admin" and rawAggregate("tasks", [{ $match: <a filter that selects only the documents of model "Staff"> }, { $merge: { into: "people" } }]) for model "Staff", and a deleteDocuments({ collection: "tasks", filter: <a filter that selects the documents of all of them> });',
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
        'such as rawAggregate("tasks", [{ $match: <a filter that selects only the documents of model "Admin"> }, {"$set":{"x":"$a"}}, {"$unset":["a"]}, { $merge: { into: "people" } }]) for model "Admin" and rawAggregate("tasks", [{ $match: <a filter that selects only the documents of model "Staff"> }, {"$set":{"x":"$b"}}, {"$unset":["b"]}, { $merge: { into: "people" } }]) for model "Staff",',
      );
    });
  });
});
