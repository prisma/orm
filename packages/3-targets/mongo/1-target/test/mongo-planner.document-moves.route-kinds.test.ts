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
      followedDrops: dropsOf(plan({ from, to, schema })),
    }).toEqual({
      user: true,
      clerk: true,
      userAsked: false,
      handWritten: true,
      followedDrops: ['Drop collection staff'],
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
