import { describe, expect, it } from 'vitest';
import {
  contract,
  plan,
  planned,
  refusal,
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

    it('moves the documents in a plan of their own when the plan rewrites documents in the target', () => {
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
          'With migration plan, keep the documents: move them in a plan of their own first, because that plan also rewrites documents in collection "members", which would reach the moved documents: make only the change that moves model "User" to collection "members", plan it without this statement, and in the operations of the migration.ts it writes, after any operation that creates collection "members" and before any other operation on collection "users", add a dataTransform',
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
});
