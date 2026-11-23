import type { MongoContract } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import {
  contract,
  type ModelSpec,
  NS,
  plan,
  planned,
  renameField,
  renameModel,
  schemaCollection,
} from './mongo-statement-fixtures';

/** Root models, each in the collection given, with one field of its own. */
function models(seed: string, collections: Readonly<Record<string, string>>): MongoContract {
  const specs: Record<string, ModelSpec> = Object.fromEntries(
    Object.entries(collections).map(([model, collection]) => [
      model,
      { collection, fields: ['_id', 'name'] },
    ]),
  );
  return contract(
    seed,
    specs,
    Object.fromEntries(Object.values(collections).map((name) => [name, {}])),
  );
}

/** The schema a contract leaves: one collection for each it names. */
function schemaOf(collections: readonly string[]) {
  return collections.map((name) => schemaCollection(name));
}

/** The conflicts of a refused plan, each checked to carry no statement. */
function refused(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
  return result.conflicts;
}

describe('MongoMigrationPlanner, collection renames that swap, chain or take a name', () => {
  it('refuses two collections that swap names, with the route through names nothing uses', () => {
    const conflicts = refused(
      plan({
        from: models('from', { User: 'users', Account: 'accounts' }),
        to: models('to', { User: 'accounts', Account: 'users' }),
        schema: schemaOf(['users', 'accounts']),
      }),
    );
    expect(conflicts).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename collection "accounts" to "users": collection "users" is renamed in the same plan',
        why: 'The collection of model "Account" changes from "accounts" to "users", and the collection of model "User" changes from "users" to "accounts". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the documents of collection "users" as documents of model "Account". Make the change in two plans: first give model "Account" the collection "prisma_swap_users" and model "User" the collection "prisma_swap_accounts", collections nothing uses, and plan and apply that; then give model "Account" the collection "users" and model "User" the collection "accounts", and plan again.',
      },
    ]);
  });

  it.each([
    [
      'User first',
      { User: 'users', Account: 'accounts' },
      { User: 'accounts', Account: 'members' },
    ],
    [
      'Account first',
      { Account: 'accounts', User: 'users' },
      { Account: 'members', User: 'accounts' },
    ],
  ])(
    'refuses a chain of collection renames the same way whichever model comes first (%s)',
    (_, from, to) => {
      expect(
        refused(
          plan({
            from: models('from', from),
            to: models('to', to),
            schema: schemaOf(['users', 'accounts']),
          }),
        ),
      ).toEqual([
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename collection "users" to "accounts": collection "accounts" is renamed in the same plan',
          why: 'The collection of model "User" changes from "users" to "accounts", and the collection of model "Account" changes from "accounts" to "members". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the documents of collection "accounts" as documents of model "User". Make the change in two plans: first give model "User" the collection "prisma_swap_accounts" and model "Account" the collection "prisma_swap_members", collections nothing uses, and plan and apply that; then give model "User" the collection "accounts" and model "Account" the collection "members", and plan again.',
        },
      ]);
    },
  );

  it('refuses a rename onto the collection of a model the destination removes', () => {
    expect(
      refused(
        plan({
          from: models('from', { User: 'users', Account: 'accounts' }),
          to: models('to', { User: 'accounts' }),
          schema: schemaOf(['users', 'accounts']),
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename collection "users" to "accounts": the schema being planned from already has a collection "accounts"',
        why: 'The collection of model "User" changes from "users" to "accounts", and the schema being planned from already has collection "accounts", the collection of model "Account". Without the rename the plan would read the documents of collection "accounts" as documents of model "User". Make the change in two plans: first remove model "Account", or keep it and change its collection to a name nothing uses, such as "prisma_swap_accounts", and plan and apply that; then make this change and plan again.',
      },
    ]);
  });

  it('refuses a model rename statement whose new collection a model that keeps its name also moves to', () => {
    const statement = renameModel('Account', 'Member');
    expect(
      plan({
        from: models('from', { User: 'users', Account: 'accounts' }),
        to: models('to', { User: 'people', Member: 'people' }),
        schema: schemaOf(['users', 'accounts']),
        statements: [statement],
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "Account" to "Member": collection "people" also stores model "User", whose documents are not in collection "accounts"',
          why: 'A collection rename moves the documents of one collection, and collection "people" would also store the documents of model "User". Moving the documents of two collections into one is a data migration, which a plan does not write. Leave out this statement to plan the change without moving them: the plan then asks about the data it drops. A question about model "Account" offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data. To keep the data with migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "Account", and those of model "User" that collection "people" does not already hold, into collection "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
          refusedStatement: statement,
        },
      ],
    });
  });

  it('refuses a rename onto the old collection of a statement rename', () => {
    expect(
      refused(
        plan({
          from: models('from', { User: 'users', Account: 'accounts' }),
          to: models('to', { User: 'accounts', Member: 'members' }),
          schema: schemaOf(['users', 'accounts']),
          statements: [renameModel('Account', 'Member')],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename collection "users" to "accounts": collection "accounts" is renamed in the same plan',
        why: 'The collection of model "User" changes from "users" to "accounts", and model "Account" is renamed to "Member", which renames collection "accounts" to "members". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the documents of collection "accounts" as documents of model "User". Make the change in two plans: first give model "User" the collection "prisma_swap_accounts" and model "Member" the collection "prisma_swap_members", collections nothing uses, and plan and apply that with the same statements; then give model "User" the collection "accounts" and model "Member" the collection "members", and plan again without them.',
      },
    ]);
  });

  it('refuses a rename out of a collection a statement rename takes', () => {
    expect(
      refused(
        plan({
          from: models('from', { User: 'users', Account: 'accounts' }),
          to: models('to', { User: 'people', Member: 'users' }),
          schema: schemaOf(['users', 'accounts']),
          statements: [renameModel('Account', 'Member')],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename collection "users" to "people": another rename in the same plan takes collection name "users"',
        why: 'The collection of model "User" changes from "users" to "people", and model "Account" is renamed to "Member", which renames collection "accounts" to "users". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out. Make the change in two plans: first give model "User" the collection "prisma_swap_people" and model "Member" the collection "prisma_swap_users", collections nothing uses, and plan and apply that with the same statements; then give model "User" the collection "people" and model "Member" the collection "users", and plan again without them.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, the routes collection rename refusals give, followed', () => {
  /** Plans each step from the one before, with the schema the step before leaves. */
  function steps(
    origin: Readonly<Record<string, string>>,
    ...rest: readonly {
      readonly to: Readonly<Record<string, string>>;
      readonly statements?: Parameters<typeof plan>[0]['statements'];
    }[]
  ) {
    let from = origin;
    return rest.map(({ to, statements }, index) => {
      const result = planned(
        plan({
          from: models(`step${index}`, from),
          to: models(`step${index + 1}`, to),
          schema: schemaOf([...new Set(Object.values(from))]),
          ...(statements === undefined ? {} : { statements }),
        }),
      );
      from = to;
      return { labels: result.labels, applied: result.applied, dataLoss: result.dataLoss };
    });
  }

  it('swaps two collections through names nothing uses', () => {
    expect(
      steps(
        { User: 'users', Account: 'accounts' },
        { to: { User: 'prisma_swap_accounts', Account: 'prisma_swap_users' } },
        { to: { User: 'accounts', Account: 'users' } },
      ),
    ).toEqual([
      {
        labels: [
          'Rename collection users to prisma_swap_accounts',
          'Rename collection accounts to prisma_swap_users',
        ],
        applied: [],
        dataLoss: [],
      },
      {
        labels: [
          'Rename collection prisma_swap_accounts to accounts',
          'Rename collection prisma_swap_users to users',
        ],
        applied: [],
        dataLoss: [],
      },
    ]);
  });

  it('moves a chain of collections through names nothing uses', () => {
    expect(
      steps(
        { User: 'users', Account: 'accounts' },
        { to: { User: 'prisma_swap_accounts', Account: 'prisma_swap_members' } },
        { to: { User: 'accounts', Account: 'members' } },
      ),
    ).toEqual([
      {
        labels: [
          'Rename collection users to prisma_swap_accounts',
          'Rename collection accounts to prisma_swap_members',
        ],
        applied: [],
        dataLoss: [],
      },
      {
        labels: [
          'Rename collection prisma_swap_accounts to accounts',
          'Rename collection prisma_swap_members to members',
        ],
        applied: [],
        dataLoss: [],
      },
    ]);
  });

  it('removes the model whose collection the rename takes, then renames', () => {
    expect(
      steps(
        { User: 'users', Account: 'accounts' },
        { to: { User: 'users' } },
        { to: { User: 'accounts' } },
      ),
    ).toEqual([
      {
        labels: ['Drop collection accounts'],
        applied: [],
        dataLoss: [
          {
            operationIndex: 0,
            subject: { kind: 'model', namespaceId: NS, model: 'Account' },
            loss: 'drop',
            label: 'Drop collection accounts',
          },
        ],
      },
      { labels: ['Rename collection users to accounts'], applied: [], dataLoss: [] },
    ]);
  });

  it('moves a chain with a statement through names nothing uses, keeping the statement for the first plan', () => {
    expect(
      steps(
        { User: 'users', Account: 'accounts' },
        {
          to: { User: 'prisma_swap_accounts', Member: 'prisma_swap_members' },
          statements: [renameModel('Account', 'Member')],
        },
        { to: { User: 'accounts', Member: 'members' } },
      ),
    ).toEqual([
      {
        labels: [
          'Rename collection users to prisma_swap_accounts',
          'Rename collection accounts to prisma_swap_members',
        ],
        applied: [[1]],
        dataLoss: [],
      },
      {
        labels: [
          'Rename collection prisma_swap_accounts to accounts',
          'Rename collection prisma_swap_members to members',
        ],
        applied: [],
        dataLoss: [],
      },
    ]);
  });

  it('moves out of a name a statement takes through names nothing uses', () => {
    expect(
      steps(
        { User: 'users', Account: 'accounts' },
        {
          to: { User: 'prisma_swap_people', Member: 'prisma_swap_users' },
          statements: [renameModel('Account', 'Member')],
        },
        { to: { User: 'people', Member: 'users' } },
      ),
    ).toEqual([
      {
        labels: [
          'Rename collection users to prisma_swap_people',
          'Rename collection accounts to prisma_swap_users',
        ],
        applied: [[1]],
        dataLoss: [],
      },
      {
        labels: [
          'Rename collection prisma_swap_people to people',
          'Rename collection prisma_swap_users to users',
        ],
        applied: [],
        dataLoss: [],
      },
    ]);
  });
});

/** `User` in `users` with the fields given, each stored under the name given. */
function user(
  seed: string,
  fields: Readonly<Record<string, string>>,
  required: readonly string[] = [],
) {
  return contract(
    seed,
    {
      User: {
        collection: 'users',
        fields: ['_id', ...Object.keys(fields)],
        storedAs: fields,
        types: Object.fromEntries(
          Object.keys(fields)
            .filter((field) => !required.includes(field))
            .map((field) => [field, { codecId: 'mongo/string@1', nullable: true }]),
        ),
      },
    },
    { users: {} },
  );
}

const usersSchema = [schemaCollection('users')];

describe('MongoMigrationPlanner, field renames that swap, chain or take a stored name', () => {
  it('refuses two fields that swap stored names', () => {
    expect(
      refused(
        plan({
          from: user('from', { a: 'x', b: 'y' }),
          to: user('to', { a: 'y', b: 'x' }),
          schema: usersSchema,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "x" to "y" in collection "users": field "y" is renamed in the same plan',
        why: 'The stored name of field "User.a" changes from "x" to "y", and the stored name of field "User.b" changes from "y" to "x". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first give field "User.a" the stored name "prisma_swap_y" and field "User.b" the stored name "prisma_swap_x", stored names nothing uses, and plan and apply that; then give field "User.a" the stored name "y" and field "User.b" the stored name "x", and plan again.',
      },
    ]);
  });

  it('refuses a chain of stored names', () => {
    expect(
      refused(
        plan({
          from: user('from', { a: 'x', b: 'y' }),
          to: user('to', { a: 'y', b: 'z' }),
          schema: usersSchema,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "x" to "y" in collection "users": field "y" is renamed in the same plan',
        why: 'The stored name of field "User.a" changes from "x" to "y", and the stored name of field "User.b" changes from "y" to "z". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first give field "User.a" the stored name "prisma_swap_y" and field "User.b" the stored name "prisma_swap_z", stored names nothing uses, and plan and apply that; then give field "User.a" the stored name "y" and field "User.b" the stored name "z", and plan again.',
      },
    ]);
  });

  it('refuses a rename onto the stored name of a field the destination removes', () => {
    expect(
      refused(
        plan({
          from: user('from', { a: 'x', b: 'y' }),
          to: user('to', { a: 'y' }),
          schema: usersSchema,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "x" to "y" in collection "users": the documents already hold field "y"',
        why: 'The stored name of field "User.a" changes from "x" to "y", and the documents already hold field "y", the stored name of field "User.b". Without the rename the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first remove field "User.b", or keep it and change its stored name to a name nothing uses, such as "prisma_swap_y", and plan and apply that; then make this change and plan again.',
      },
    ]);
  });

  it('refuses a rename onto the stored name a field rename statement frees', () => {
    expect(
      refused(
        plan({
          from: user('from', { a: 'x', b: 'y' }),
          to: user('to', { a: 'y', c: 'z' }),
          schema: usersSchema,
          statements: [renameField('User', 'b', 'User', 'c')],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "x" to "y" in collection "users": field "y" is renamed in the same plan',
        why: 'The stored name of field "User.a" changes from "x" to "y", and field "User.b" is renamed to "User.c", which renames field "y" to "z" in collection "users". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first give field "User.a" the stored name "prisma_swap_y" and field "User.c" the stored name "prisma_swap_z", stored names nothing uses, and plan and apply that with the same statements; then give field "User.a" the stored name "y" and field "User.c" the stored name "z", and plan again without them.',
      },
    ]);
  });

  it('refuses a rename out of a stored name a field rename statement takes', () => {
    expect(
      refused(
        plan({
          from: user('from', { a: 'x', b: 'y' }),
          to: user('to', { a: 'z', c: 'x' }),
          schema: usersSchema,
          statements: [renameField('User', 'b', 'User', 'c')],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "x" to "z" in collection "users": another rename in the same plan takes stored name "x"',
        why: 'The stored name of field "User.a" changes from "x" to "z", and field "User.b" is renamed to "User.c", which renames field "y" to "x" in collection "users". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out. Make the change in two plans: first give field "User.a" the stored name "prisma_swap_z" and field "User.c" the stored name "prisma_swap_x", stored names nothing uses, and plan and apply that with the same statements; then give field "User.a" the stored name "z" and field "User.c" the stored name "x", and plan again without them.',
      },
    ]);
  });

  it('refuses a new required field stored under the old name of a renamed field', () => {
    expect(
      refused(
        plan({
          from: user('from', { email: 'email' }),
          to: user('to', { email: 'emailAddress', legacy: 'email' }, ['legacy']),
          schema: usersSchema,
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot plan the migration: the migration writes a field that another of its operations reads (Rename field email to emailAddress in collection users; Fill field email in collection users where it is missing or null)',
        why: "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents. An operation that reads a field another operation of the same migration writes acts on what that operation wrote: at once when it runs later, and when the migration runs again after a later operation stops. Make the change as two changes to the contract, and apply the first, by a migration or by db update, before you make the second: first make the rename, without the new required field; then add the new field.",
      },
    ]);
  });
});

describe('MongoMigrationPlanner, the routes field rename refusals give, followed', () => {
  function steps(
    origin: {
      readonly fields: Readonly<Record<string, string>>;
      readonly required?: readonly string[];
    },
    ...rest: readonly {
      readonly fields: Readonly<Record<string, string>>;
      readonly required?: readonly string[];
      readonly statements?: Parameters<typeof plan>[0]['statements'];
    }[]
  ) {
    let from = origin;
    return rest.map((step, index) => {
      const result = planned(
        plan({
          from: user(`step${index}`, from.fields, from.required),
          to: user(`step${index + 1}`, step.fields, step.required),
          schema: usersSchema,
          ...(step.statements === undefined ? {} : { statements: step.statements }),
        }),
      );
      from = step;
      return { labels: result.labels, applied: result.applied, dataLoss: result.dataLoss };
    });
  }

  it('swaps two stored names through names nothing uses', () => {
    expect(
      steps(
        { fields: { a: 'x', b: 'y' } },
        { fields: { a: 'prisma_swap_y', b: 'prisma_swap_x' } },
        { fields: { a: 'y', b: 'x' } },
      ),
    ).toEqual([
      {
        labels: [
          'Rename field x to prisma_swap_y in collection users',
          'Rename field y to prisma_swap_x in collection users',
        ],
        applied: [],
        dataLoss: [],
      },
      {
        labels: [
          'Rename field prisma_swap_y to y in collection users',
          'Rename field prisma_swap_x to x in collection users',
        ],
        applied: [],
        dataLoss: [],
      },
    ]);
  });

  it('moves a chain of stored names through names nothing uses', () => {
    expect(
      steps(
        { fields: { a: 'x', b: 'y' } },
        { fields: { a: 'prisma_swap_y', b: 'prisma_swap_z' } },
        { fields: { a: 'y', b: 'z' } },
      ),
    ).toEqual([
      {
        labels: [
          'Rename field x to prisma_swap_y in collection users',
          'Rename field y to prisma_swap_z in collection users',
        ],
        applied: [],
        dataLoss: [],
      },
      {
        labels: [
          'Rename field prisma_swap_y to y in collection users',
          'Rename field prisma_swap_z to z in collection users',
        ],
        applied: [],
        dataLoss: [],
      },
    ]);
  });

  it('removes the field whose stored name the rename takes, then renames', () => {
    expect(
      steps({ fields: { a: 'x', b: 'y' } }, { fields: { a: 'x' } }, { fields: { a: 'y' } }),
    ).toEqual([
      {
        labels: ['Remove field y from collection users'],
        applied: [],
        dataLoss: [
          {
            operationIndex: 0,
            subject: { kind: 'field', namespaceId: NS, model: 'User', field: 'b' },
            loss: 'drop',
            label: 'Remove field y from collection users',
          },
        ],
      },
      { labels: ['Rename field x to y in collection users'], applied: [], dataLoss: [] },
    ]);
  });

  it('moves a stored name a statement frees through names nothing uses, keeping the statement for the first plan', () => {
    expect(
      steps(
        { fields: { a: 'x', b: 'y' } },
        {
          fields: { a: 'prisma_swap_y', c: 'prisma_swap_z' },
          statements: [renameField('User', 'b', 'User', 'c')],
        },
        { fields: { a: 'y', c: 'z' } },
      ),
    ).toEqual([
      {
        labels: [
          'Rename field y to prisma_swap_z in collection users',
          'Rename field x to prisma_swap_y in collection users',
        ],
        applied: [[0]],
        dataLoss: [],
      },
      {
        labels: [
          'Rename field prisma_swap_y to y in collection users',
          'Rename field prisma_swap_z to z in collection users',
        ],
        applied: [],
        dataLoss: [],
      },
    ]);
  });

  it('moves out of a stored name a statement takes through names nothing uses', () => {
    expect(
      steps(
        { fields: { a: 'x', b: 'y' } },
        {
          fields: { a: 'prisma_swap_z', c: 'prisma_swap_x' },
          statements: [renameField('User', 'b', 'User', 'c')],
        },
        { fields: { a: 'z', c: 'x' } },
      ),
    ).toEqual([
      {
        labels: [
          'Rename field y to prisma_swap_x in collection users',
          'Rename field x to prisma_swap_z in collection users',
        ],
        applied: [[0]],
        dataLoss: [],
      },
      {
        labels: [
          'Rename field prisma_swap_z to z in collection users',
          'Rename field prisma_swap_x to x in collection users',
        ],
        applied: [],
        dataLoss: [],
      },
    ]);
  });

  it('renames the field, then adds the new required field under its old stored name', () => {
    expect(
      steps(
        { fields: { email: 'email' } },
        { fields: { email: 'emailAddress' } },
        { fields: { email: 'emailAddress', legacy: 'email' }, required: ['legacy'] },
      ),
    ).toEqual([
      {
        labels: ['Rename field email to emailAddress in collection users'],
        applied: [],
        dataLoss: [],
      },
      {
        labels: ['Fill field email in collection users where it is missing or null'],
        applied: [],
        dataLoss: [],
      },
    ]);
  });
});

describe('MongoMigrationPlanner, an embedded relation whose stored name changes', () => {
  const order = (seed: string, stored: string) =>
    contract(
      seed,
      {
        Order: { collection: 'orders', fields: ['_id'], embeds: { items: stored } },
        Embedded: { fields: ['sku'], owner: 'Order' },
      },
      { orders: {} },
    );

  it('is refused, naming the contract change and no statement', () => {
    expect(
      refused(
        plan({
          from: order('from', 'items'),
          to: order('to', 'lineItems'),
          schema: [schemaCollection('orders')],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "items" to "lineItems" in collection "orders": the field is an embedded relation',
        why: 'The stored name of embedded relation "Order.items" changes from "items" to "lineItems", and renaming an embedded relation is not supported in this release. Keep the stored name "items" in the contract, then run this command again.',
      },
    ]);
  });

  it('plans nothing once the stored name is kept, as the refusal says', () => {
    expect(
      planned(
        plan({
          from: order('from', 'items'),
          to: order('to', 'items'),
          schema: [schemaCollection('orders')],
        }),
      ),
    ).toEqual({ labels: [], classes: [], applied: [], dataLoss: [] });
  });
});
