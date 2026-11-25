import { describe, expect, it } from 'vitest';
import { contract, plan, refusal, renameModel, schemaCollection } from './mongo-statement-fixtures';

const INT = { codecId: 'mongo/int32@1' };
const STR = { codecId: 'mongo/string@1' };

function routeOf(result: ReturnType<typeof plan>): string {
  return refusal(result)[0]?.why ?? '';
}

describe('MongoMigrationPlanner, a route over models leaving a source when the plan without the statements is refused too', () => {
  const from = contract(
    'from',
    {
      User: { collection: 'users', fields: ['_id', 'user'] },
      Admin: { collection: 'users', fields: ['_id', 'admin'] },
      Guest: { collection: 'guests', fields: ['_id', 'age'], types: { age: STR } },
      Clerk: { collection: 'clerks', fields: ['_id', 'age'], types: { age: INT } },
    },
    { users: {}, guests: {}, clerks: {} },
  );
  const to = (keepsUsers: boolean) =>
    contract(
      'to',
      {
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Boss: { collection: 'bosses', fields: ['_id', 'admin'] },
        Guest: { collection: 'guests', fields: ['_id', 'age'], types: { age: INT } },
        Teller: { collection: 'guests', fields: ['_id', 'age'], types: { age: INT } },
      },
      { members: {}, bosses: {}, guests: {}, ...(keepsUsers ? { users: {} } : {}) },
    );
  const schema = ['users', 'guests', 'clerks'].map((name) => schemaCollection(name));
  const statements = [
    renameModel('User', 'Member'),
    renameModel('Admin', 'Boss'),
    renameModel('Clerk', 'Teller'),
  ];
  const consequencesOf = (keepsUsers: boolean) =>
    routeOf(plan({ from, to: to(keepsUsers), schema, statements })).split('\n\n')[1];

  it('says the models are removed with no question when the destination keeps the source', () => {
    expect(consequencesOf(true)).toBe(
      'Leave out --rename User:Member, --rename Admin:Boss and --rename Clerk:Teller to plan the change without moving them. Models "User" and "Admin" are then removed and nothing is asked, since nothing is deleted. Their documents stay in collection "users", where no model reads them. Model "Member" starts with no documents. Model "Boss" starts with no documents. If the new validator of collection "users" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there. The plan then asks about the data of model "Clerk", which it drops. Its question offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data.',
    );
  });

  it('says the drop asks about every model it loses when the destination does not keep the source', () => {
    expect(consequencesOf(false)).toBe(
      'Leave out --rename User:Member, --rename Admin:Boss and --rename Clerk:Teller to plan the change without moving them. The plan then asks about the data of models "User", "Admin" and "Clerk", which it drops. Its question offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data.',
    );
  });

  it('says the models are removed with no question when the destination leaves out an external source, which the plan does not drop', () => {
    const fromExternal = contract(
      'from',
      {
        User: { collection: 'users', fields: ['_id', 'user'] },
        Admin: { collection: 'users', fields: ['_id', 'admin'] },
        Guest: { collection: 'guests', fields: ['_id', 'age'], types: { age: STR } },
        Clerk: { collection: 'clerks', fields: ['_id', 'age'], types: { age: INT } },
      },
      { users: { control: 'external' }, guests: {}, clerks: {} },
    );
    const why = routeOf(plan({ from: fromExternal, to: to(false), schema, statements }));
    expect(why.split('\n\n')[1]).toBe(
      'Leave out --rename User:Member, --rename Admin:Boss and --rename Clerk:Teller to plan the change without moving them. Models "User" and "Admin" are then removed and nothing is asked, since nothing is deleted. Their documents stay in collection "users", where no model reads them. Model "Member" starts with no documents. Model "Boss" starts with no documents. If the new validator of collection "users" does not accept them, its change stops the apply in every database that holds them, until they are deleted or moved there. The plan then asks about the data of model "Clerk", which it drops. Its question offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data.',
    );
  });
});

describe('MongoMigrationPlanner, a route over a model leaving a kept source whose other model moves by its own @@map change', () => {
  it('names no model as still reading the documents left in the source', () => {
    const from = contract(
      'from',
      {
        User: { collection: 'users', fields: ['_id', 'user'] },
        Admin: { collection: 'users', fields: ['_id', 'admin'] },
      },
      { users: {} },
    );
    const to = contract(
      'to',
      {
        Member: { collection: 'members', fields: ['_id', 'user'] },
        Admin: { collection: 'admins', fields: ['_id', 'admin'] },
      },
      { users: {}, members: {}, admins: {} },
    );
    const why = routeOf(
      plan({
        from,
        to,
        schema: [schemaCollection('users')],
        statements: [renameModel('User', 'Member')],
      }),
    );
    expect(why).toContain(
      'Model "User" is then removed and nothing is asked, since nothing is deleted. Its documents stay in collection "users", where no model reads them.',
    );
  });
});
