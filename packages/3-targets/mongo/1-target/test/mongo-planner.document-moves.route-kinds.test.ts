import type { ResolvedMigrationStatement } from '@internal/framework-components/control';
import { describe, expect, it } from 'vitest';
import {
  contract,
  plan,
  planned,
  refusal,
  renameField,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

const ADMIN = { collection: 'users', fields: ['_id', 'admin'] };
const INT = { codecId: 'mongo/int32@1' };
const STR = { codecId: 'mongo/string@1' };

const USER_LEAVES =
  'Model "User" is then removed and nothing is asked, since nothing is deleted. Its documents stay in collection "users", where model "Admin" still reads them. Model "Member" reads the documents of model "Guest" already stored in its collection, since no discriminator tells them apart. If the new validator of collection "users" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there.';

function routeOf(result: ReturnType<typeof plan>): string {
  return refusal(result)[0]?.why ?? '';
}

function dropsOf(result: ReturnType<typeof plan>): readonly string[] {
  return planned(result).dataLoss.map(({ label }) => label);
}

describe('MongoMigrationPlanner, a route over refused groups of different kinds', () => {
  it('says a model that leaves a collection others keep is removed with no question, beside a merge that asks', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Clerk: { collection: 'staff', fields: ['_id', 'clerk'] },
        Visitor: { collection: 'guests', fields: ['_id', 'visitor'] },
      },
      { users: {}, members: {}, staff: {}, guests: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Teller: { collection: 'guests', fields: ['_id', 'clerk'] },
        Visitor: { collection: 'guests', fields: ['_id', 'visitor'] },
      },
      { users: {}, members: {}, guests: {} },
    );
    const schema = ['users', 'members', 'staff', 'guests'].map((name) => schemaCollection(name));
    const statements = [renameModel('User', 'Member'), renameModel('Clerk', 'Teller')];
    const why = routeOf(plan({ from, to, schema, statements }));
    expect({
      user: why.includes(USER_LEAVES),
      clerk: why.includes('The plan then asks about the data of model "Clerk", which it drops.'),
      userAsked: why.includes('asks about the data of model "User"'),
      handWritten: why.includes('write this change as a hand-written migration instead'),
      clerkRewritten: why.includes('the documents of model "Clerk" into collection "guests"'),
      visitorRewritten: why.includes('those of model "Visitor"'),
      followedDrops: dropsOf(plan({ from, to, schema })),
    }).toEqual({
      user: true,
      clerk: true,
      userAsked: false,
      handWritten: true,
      clerkRewritten: true,
      visitorRewritten: false,
      followedDrops: ['Drop collection staff'],
    });
  });

  describe('a split and a merge refused together', () => {
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Clerk: { collection: 'staff', fields: ['_id', 'clerk'] },
        Visitor: { collection: 'guests', fields: ['_id', 'visitor'] },
      },
      { users: {}, members: {}, staff: {}, guests: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Teller: { collection: 'guests', fields: ['_id', 'clerk'] },
        Visitor: { collection: 'guests', fields: ['_id', 'visitor'] },
      },
      { users: {}, members: {}, guests: {} },
    );
    const schema = ['users', 'members', 'staff', 'guests'].map((name) => schemaCollection(name));
    const SPLIT_SUMMARY =
      'Cannot rename model "User" to "Member": collection "users" also stores model "Admin"';
    const SPLIT_REASON =
      'A collection rename moves every document of the collection, and the documents of model "Admin" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.';
    const MERGE_SUMMARY =
      'Cannot rename model "Clerk" to "Teller": collection "guests" also stores model "Visitor", whose documents are not in collection "staff"';
    const MERGE_REASON =
      'A collection rename moves the documents of one collection, and collection "guests" would also store the documents of model "Visitor". Moving the documents of two collections into one is a data migration, which a plan does not write.';

    function textsOf(statements: readonly ResolvedMigrationStatement[]) {
      const [printer, pointer] = refusal(plan({ from, to, schema, statements }));
      return {
        printer: { summary: printer?.summary, why: printer?.why?.split('\n\n')[0] },
        pointer: { summary: pointer?.summary, why: pointer?.why },
      };
    }

    it('keeps the merge its own reason when the split prints the route', () => {
      expect(textsOf([renameModel('User', 'Member'), renameModel('Clerk', 'Teller')])).toEqual({
        printer: { summary: SPLIT_SUMMARY, why: SPLIT_REASON },
        pointer: {
          summary: MERGE_SUMMARY,
          why: `${MERGE_REASON}\n\nLeave out --rename User:Member and --rename Clerk:Teller to plan the change without moving them: the refusal of --rename User:Member says what that plan does, and how to keep the documents.`,
        },
      });
    });

    it('keeps the split its own reason when the merge prints the route', () => {
      expect(textsOf([renameModel('Clerk', 'Teller'), renameModel('User', 'Member')])).toEqual({
        printer: { summary: MERGE_SUMMARY, why: MERGE_REASON },
        pointer: {
          summary: SPLIT_SUMMARY,
          why: `${SPLIT_REASON}\n\nLeave out --rename Clerk:Teller and --rename User:Member to plan the change without moving them: the refusal of --rename Clerk:Teller says what that plan does, and how to keep the documents.`,
        },
      });
    });
  });

  it('says a variant that leaves its base collection is asked about, beside a model removed with no question', () => {
    const task = { collection: 'tasks', fields: ['_id', 'type'], discriminator: 'type' };
    const from = contract(
      'from',
      {
        Admin: ADMIN,
        User: { collection: 'users', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Task: { ...task, variants: { Bug: 'bug', Feat: 'feat' } },
        Bug: { fields: ['sev'], base: 'Task' },
        Feat: { fields: ['area'], base: 'Task' },
      },
      { users: {}, members: {}, tasks: {} },
    );
    const to = contract(
      'to',
      {
        Admin: ADMIN,
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Guest: { collection: 'members', fields: ['_id', 'guest'] },
        Task: { ...task, variants: { Feat: 'feat' } },
        Feat: { fields: ['area'], base: 'Task' },
        Defect: { collection: 'defects', fields: ['_id', 'sev'] },
      },
      { users: {}, members: {}, tasks: {}, defects: {} },
    );
    const schema = ['users', 'members', 'tasks'].map((name) => schemaCollection(name));
    const statements = [renameModel('User', 'Member'), renameModel('Bug', 'Defect')];
    const why = routeOf(plan({ from, to, schema, statements }));
    expect({
      user: why.includes(USER_LEAVES),
      bug: why.includes('The plan then asks about the data of model "Bug", which it drops.'),
      userAsked: why.includes('asks about the data of model "User"'),
      followedDrops: dropsOf(plan({ from, to, schema })),
    }).toEqual({
      user: true,
      bug: true,
      userAsked: false,
      followedDrops: ['Delete the documents of collection tasks whose type is "bug"'],
    });
  });

  it('lists the refusal of the plan without the statements on a hand-written route as well', () => {
    const guest = (codec: typeof INT) => ({
      collection: 'members',
      fields: ['_id', 'guest', 'age'],
      types: { age: codec },
    });
    const from = contract(
      'from',
      {
        User: { collection: 'users', fields: ['_id', 'age'], types: { age: INT } },
        Guest: guest(STR),
      },
      { users: {}, members: {} },
    );
    const to = contract(
      'to',
      {
        Member: { collection: 'members', fields: ['_id', 'age'], types: { age: INT } },
        Guest: guest(INT),
      },
      { members: {} },
    );
    const schema = [schemaCollection('users'), schemaCollection('members')];
    const conflicts = refusal(
      plan({ from, to, schema, statements: [renameModel('User', 'Member')] }),
    );
    expect({
      summaries: conflicts.map(({ summary }) => summary),
      said: conflicts[0]?.why?.includes(
        'Planned without it, the change is refused for another reason as well: "Cannot cast field "age" of model "Guest" in collection "members": model "Member" stores it in the same collection". That refusal is listed here too, with what to change first.',
      ),
    }).toEqual({
      summaries: [
        'Cannot rename model "User" to "Member": collection "members" also stores model "Guest", whose documents are not in collection "users"',
        'Cannot cast field "age" of model "Guest" in collection "members": model "Member" stores it in the same collection',
      ],
      said: true,
    });
  });
});

describe('MongoMigrationPlanner, a route whose move has several copies', () => {
  const from = contract(
    'from',
    {
      Admin: ADMIN,
      A: { collection: 'users', fields: ['_id', 'a'] },
      B: { collection: 'users', fields: ['_id', 'b'] },
      Guest: { collection: 'members', fields: ['_id', 'guest'] },
      Staff: { collection: 'staff', fields: ['_id', 'staff'] },
      Clerk: { collection: 'staff', fields: ['_id', 'clerk'] },
    },
    { users: {}, members: {}, staff: {} },
  );
  const to = contract(
    'to',
    {
      Admin: ADMIN,
      A2: { collection: 'members', fields: ['_id', 'x'] },
      B2: { collection: 'members', fields: ['_id', 'y'] },
      Guest: { collection: 'members', fields: ['_id', 'guest'] },
      Staff: { collection: 'staff', fields: ['_id', 'staff'] },
      Teller: { collection: 'members', fields: ['_id', 'clerk'] },
    },
    { users: {}, members: {}, staff: {} },
  );
  const schema = ['users', 'members', 'staff'].map((name) => schemaCollection(name));
  const statements = [
    renameModel('A', 'A2'),
    renameModel('B', 'B2'),
    renameField('A', 'a', 'A2', 'x'),
    renameField('B', 'b', 'B2', 'y'),
    renameModel('Clerk', 'Teller'),
  ];

  it('gives each copy its own dataTransform, with the delete after them as an operation of its own', () => {
    const why = routeOf(plan({ from, to, schema, statements }));
    expect({
      eachCopy: why.includes(
        'For models "A" and "B", at the start of the operations of the migration.ts it writes, before the plan\'s own operations on collection "users", add one dataTransform for each group of models whose documents change alike on the way into collection "members". The run of each is one of these copies:',
      ),
      deleteAfter: [
        why.includes(
          'After them, add the operation that deletes the documents of models "A" and "B" from collection "users":',
        ),
        why.includes(
          'After it, add the operation that deletes the documents of model "Clerk" from collection "staff":',
        ),
      ],
      deletedByTheTransform: why.includes('Then it deletes them'),
      count: why.includes(
        'All 3 dataTransforms go in that one migration.ts. Run it to emit its ops.json, and apply it once with db migrate.',
      ),
    }).toEqual({
      eachCopy: true,
      deleteAfter: [true, true],
      deletedByTheTransform: false,
      count: true,
    });
  });

  it('says once, in short, what the plan without the statements does to the models of both collections', () => {
    const why = routeOf(plan({ from, to, schema, statements }));
    expect(why).toContain(
      'Models "A", "B" and "Clerk" are then removed and nothing is asked, since nothing is deleted. Their documents stay where they are: those of models "A" and "B" in collection "users", where model "Admin" still reads them, and those of model "Clerk" in collection "staff", where model "Staff" still reads them. Models "A2", "B2" and "Teller" read the documents of model "Guest" already stored in their collection, since no discriminator tells them apart. If the new validator of collection "users" or "staff" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there.',
    );
  });
});

describe('MongoMigrationPlanner, a route when the plan without the statements drops the source collection', () => {
  const from = contract(
    'from',
    {
      User: { collection: 'users', fields: ['_id', 'user'] },
      Admin: ADMIN,
      Auditor: { collection: 'users', fields: ['_id', 'auditor'] },
    },
    { users: {} },
  );
  const to = contract(
    'to',
    {
      Member: { collection: 'members', fields: ['_id', 'user'] },
      Admin: { collection: 'admins', fields: ['_id', 'admin'] },
      Auditor: { collection: 'auditors', fields: ['_id', 'auditor'] },
    },
    { members: {}, admins: {}, auditors: {} },
  );
  const schema = [schemaCollection('users')];

  it('moves the documents of every model leaving the collection, and says to answer the drop question with --delete', () => {
    expect({
      followedDrops: dropsOf(plan({ from, to, schema })),
      why: routeOf(plan({ from, to, schema, statements: [renameModel('User', 'Member')] })),
    }).toEqual({
      followedDrops: ['Drop collection users', 'Drop collection users', 'Drop collection users'],
      why: 'A collection rename moves every document of the collection, and the documents of models "Admin" and "Auditor" do not move to collection "members". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.\n\nLeave out --rename User:Member to plan the change without moving them. The plan then asks about the data of models "User", "Admin" and "Auditor", which it drops. Its question offers this same rename again, which is refused again for the same reason. Answered with the --delete it also offers, it plans the change; under db update that deletes the data.\n\nWith migration plan, keep the documents by moving them in the migration that plan writes. Plan the change without --rename User:Member, and answer its question about models "User", "Admin" and "Auditor" with the --delete it offers: the copies below run before the plan drops collection "users", so they keep the documents, and the drop removes only the emptied collection.\n\nFor model "User", in the operations of the migration.ts it writes, right after the creation of collection "members" and before the plan\'s own operations on collection "users", add a dataTransform. Its run copies the documents of model "User" into collection "members":\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "members" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "User" from collection "users":\n\n  deleteDocuments({ collection: "users", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "users", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "User" stores. If it stores none, no field tells its documents apart: select them by their _id values instead.\n\nFor model "Admin", in the operations of the migration.ts it writes, right after the creation of collection "admins" and before the plan\'s own operations on collection "users", add a dataTransform. Its run copies the documents of model "Admin" into collection "admins":\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "admins" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "Admin" from collection "users":\n\n  deleteDocuments({ collection: "users", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "users", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "Admin" stores. If it stores none, no field tells its documents apart: select them by their _id values instead.\n\nFor model "Auditor", in the operations of the migration.ts it writes, right after the creation of collection "auditors" and before the plan\'s own operations on collection "users", add a dataTransform. Its run copies the documents of model "Auditor" into collection "auditors":\n\n  rawAggregate("users", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "auditors" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "Auditor" from collection "users":\n\n  deleteDocuments({ collection: "users", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "users", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "Auditor" stores. If it stores none, no field tells its documents apart: select them by their _id values instead.\n\nAll 3 dataTransforms go in that one migration.ts. Run it to emit its ops.json, and apply it once with db migrate.\n\nStop writes to each collection the documents move out of until the apply ends: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, retries included: a document written there after the check could hold the _id of a document that moves.\n\nIf the apply stops, fix what stopped it and run db migrate again.',
    });
  });
});
