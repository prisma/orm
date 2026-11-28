import { describe, expect, it } from 'vitest';
import {
  contract,
  NS,
  plan,
  planned,
  renameField,
  schemaCollection,
} from './mongo-statement-fixtures';

function refused(result: ReturnType<typeof plan>) {
  if (result.kind !== 'failure') throw new Error('Expected the plan to be refused');
  return result.conflicts;
}

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
        why: 'The stored name of field "User.a" changes from "x" to "y", and the stored name of field "User.b" changes from "y" to "x". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first give field "User.a" the stored name (@map) "prisma_swap_y" and field "User.b" the stored name (@map) "prisma_swap_x", stored names neither contract uses, and plan and apply that; then give field "User.a" the stored name (@map) "y" and field "User.b" the stored name (@map) "x", and plan again. If the documents already hold a field of one of those names, pick another.',
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
        why: 'The stored name of field "User.a" changes from "x" to "y", and the stored name of field "User.b" changes from "y" to "z". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first give field "User.a" the stored name (@map) "prisma_swap_y" and field "User.b" the stored name (@map) "prisma_swap_z", stored names neither contract uses, and plan and apply that; then give field "User.a" the stored name (@map) "y" and field "User.b" the stored name (@map) "z", and plan again. If the documents already hold a field of one of those names, pick another.',
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
        why: 'The stored name of field "User.a" changes from "x" to "y", and the documents already hold field "y", the stored name of field "User.b". Without the rename the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first remove field "User.b", or keep it and change its stored name (@map) to a name neither contract uses, such as "prisma_swap_y", or another if the documents already hold a field of that name, and plan and apply that; then make this change and plan again.',
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
        why: 'The stored name of field "User.a" changes from "x" to "y", and field "User.b" is renamed to "User.c", which renames field "y" to "z" in collection "users". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out, and without the renames the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first give field "User.a" the stored name (@map) "prisma_swap_y" and field "User.c" the stored name (@map) "prisma_swap_z", stored names neither contract uses, and plan and apply that with the same statements; then give field "User.a" the stored name (@map) "y" and field "User.c" the stored name (@map) "z", and plan again without them. If the documents already hold a field of one of those names, pick another.',
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
        why: 'The stored name of field "User.a" changes from "x" to "z", and field "User.b" is renamed to "User.c", which renames field "y" to "x" in collection "users". A rename onto a name another rename frees, or takes, needs an order or a temporary name that the plan does not work out. Make the change in two plans: first give field "User.a" the stored name (@map) "prisma_swap_z" and field "User.c" the stored name (@map) "prisma_swap_x", stored names neither contract uses, and plan and apply that with the same statements; then give field "User.a" the stored name (@map) "z" and field "User.c" the stored name (@map) "x", and plan again without them. If the documents already hold a field of one of those names, pick another.',
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

  it('refuses a field rename onto the stored name of an embedded relation the destination removes, as a takeover', () => {
    const from = contract(
      'from',
      {
        User: {
          collection: 'users',
          fields: ['_id', 'a'],
          storedAs: { a: 'x' },
          embeds: { notes: 'y' },
        },
        Embedded: { fields: ['text'], owner: 'User' },
      },
      { users: {} },
    );
    const to = contract(
      'to',
      { User: { collection: 'users', fields: ['_id', 'a'], storedAs: { a: 'y' } } },
      { users: {} },
    );
    expect(refused(plan({ from, to, schema: [schemaCollection('users')] }))).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "x" to "y" in collection "users": the documents already hold field "y"',
        why: 'The stored name of field "User.a" changes from "x" to "y", and the documents already hold field "y", the stored name of embedded relation "User.notes". Without the rename the plan would read the values of field "y" as values of field "User.a". Removing embedded relation "User.notes" does not free the name: it plans nothing, and its key stays in the documents. Keep the stored name "x" of field "User.a" in the contract.',
      },
    ]);
  });
});

describe('MongoMigrationPlanner, why the removal of an embedded relation does not free its stored name', () => {
  const geo = { field: 'g', model: 'Geo', cardinality: '1:1' } as const;
  const addr = { field: 'addr', model: 'Address', cardinality: '1:1' } as const;
  const labels = (result: ReturnType<typeof plan>) => planned(result).labels;

  it('plans nothing for a nested or a top-level embedded relation the destination removes, so its key stays', () => {
    const nested = plan({
      from: contract(
        'from',
        {
          User: { collection: 'users', fields: ['_id'], embeds: { addr } },
          Address: {
            owner: 'User',
            fields: ['street'],
            storedAs: { street: 's' },
            embeds: { geo },
          },
          Geo: { owner: 'Address', fields: ['lat'] },
        },
        { users: {} },
      ),
      to: contract(
        'to',
        {
          User: { collection: 'users', fields: ['_id'], embeds: { addr } },
          Address: { owner: 'User', fields: ['street'], storedAs: { street: 's' } },
        },
        { users: {} },
      ),
      schema: [schemaCollection('users')],
    });
    const topLevel = plan({
      from: contract(
        'from',
        {
          User: { collection: 'users', fields: ['_id', 'a'], embeds: { notes: 'notes' } },
          Note: { owner: 'User', fields: ['text'] },
        },
        { users: {} },
      ),
      to: contract('to', { User: { collection: 'users', fields: ['_id', 'a'] } }, { users: {} }),
      schema: [schemaCollection('users')],
    });
    expect({ nested: labels(nested), topLevel: labels(topLevel) }).toEqual({
      nested: [],
      topLevel: [],
    });
  });

  it('then plans the rename onto the key the relation still holds in the documents', () => {
    const nested = plan({
      from: contract(
        'from',
        {
          User: { collection: 'users', fields: ['_id'], embeds: { addr } },
          Address: { owner: 'User', fields: ['street'], storedAs: { street: 's' } },
        },
        { users: {} },
      ),
      to: contract(
        'to',
        {
          User: { collection: 'users', fields: ['_id'], embeds: { addr } },
          Address: { owner: 'User', fields: ['street'], storedAs: { street: 'g' } },
        },
        { users: {} },
      ),
      schema: [schemaCollection('users')],
    });
    const topLevel = plan({
      from: contract(
        'from',
        { User: { collection: 'users', fields: ['_id', 'a'] } },
        { users: {} },
      ),
      to: contract(
        'to',
        { User: { collection: 'users', fields: ['_id', 'a'], storedAs: { a: 'notes' } } },
        { users: {} },
      ),
      schema: [schemaCollection('users')],
    });
    expect({ nested: labels(nested), topLevel: labels(topLevel) }).toEqual({
      nested: ['Rename key "s" to "g" at path "$" in field addr of collection users'],
      topLevel: ['Rename field a to notes in collection users'],
    });
  });
});
