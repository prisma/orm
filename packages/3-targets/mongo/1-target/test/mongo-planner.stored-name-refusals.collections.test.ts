import type { MongoContract } from '@internal/mongo-contract';
import { describe, expect, it } from 'vitest';
import {
  contract,
  type ModelSpec,
  NS,
  plan,
  planned,
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

  it('offers no temporary collection name the database already has', () => {
    const [conflict] = refused(
      plan({
        from: models('from', { User: 'users', Account: 'accounts' }),
        to: models('to', { User: 'accounts', Account: 'users' }),
        schema: schemaOf(['users', 'accounts', 'prisma_swap_accounts']),
      }),
    );
    expect(conflict?.why).toContain(
      'first give model "Account" the collection "prisma_swap_users" and model "User" the collection "prisma_swap_accounts_", collections nothing uses',
    );
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
          why: 'A collection rename moves the documents of one collection, and collection "people" would also store the documents of model "User". Moving the documents of two collections into one is a data migration, which a plan does not write.\n\nLeave out --rename Account:Member to plan the change without moving them. The plan then asks about the data of model "Account", which it drops. Its question offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data.\n\nWith migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "Account", and those of model "User" that collection "people" does not already hold, into collection "people" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.',
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

describe('MongoMigrationPlanner, a chain whose next link is a merge', () => {
  it('refuses the rename onto the merging collection and says its storage is being merged', () => {
    expect(
      refused(
        plan({
          from: models('from', { User: 'users', A: 'accounts', B: 'bs' }),
          to: models('to', { User: 'accounts', A: 'people', B: 'people' }),
          schema: schemaOf(['users', 'accounts', 'bs']),
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename collection "users" to "accounts": the schema being planned from already has a collection "accounts"',
        why: 'The collection of model "User" changes from "users" to "accounts", and the schema being planned from already has collection "accounts", the collection of model "A". Model "A" moves to collection "people" with model "B", whose documents are in another collection, so their storage is being merged, which the plan does not do, and collection "accounts" keeps its name. Without the rename the plan would read the documents of collection "accounts" as documents of model "User". Make the change in two plans: first remove model "A", or keep it and change its collection to a name nothing uses, such as "prisma_swap_accounts", and plan and apply that; then make this change and plan again.',
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
