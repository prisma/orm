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

const usersSchema = [schemaCollection('users')];

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

  it('is not refused when the model moves out of the collection it shares, since no document moves', () => {
    const people = (seed: string, collection: string, stored: string) =>
      contract(
        seed,
        {
          Admin: { collection: 'people', fields: ['_id'] },
          User: { collection, fields: ['_id'], embeds: { addr: stored } },
          Address: { fields: ['city'], owner: 'User' },
        },
        Object.fromEntries([...new Set(['people', collection])].map((name) => [name, {}])),
      );
    const result = plan({
      from: people('from', 'people', 'addr'),
      to: people('to', 'members', 'address'),
      schema: [schemaCollection('people')],
    });
    expect(result.kind === 'failure' ? result.conflicts.map(({ summary }) => summary) : []).toEqual(
      [],
    );
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

describe('MongoMigrationPlanner, field renames onto a stored name another model of the collection holds', () => {
  const nullable = { codecId: 'mongo/string@1', nullable: true };
  const shared = (seed: string, a: string) =>
    contract(
      seed,
      {
        Admin: {
          collection: 'users',
          fields: ['_id', 'b'],
          storedAs: { b: 'y' },
          types: { b: nullable },
        },
        User: {
          collection: 'users',
          fields: ['_id', 'a'],
          storedAs: { a },
          types: { a: nullable },
        },
      },
      { users: {} },
    );
  const tasks = (
    seed: string,
    taskFields: Readonly<Record<string, string>>,
    bugFields: Readonly<Record<string, string>>,
  ) =>
    contract(
      seed,
      {
        Task: {
          collection: 'tasks',
          fields: ['_id', 'type', ...Object.keys(taskFields)],
          storedAs: taskFields,
          types: Object.fromEntries(Object.keys(taskFields).map((field) => [field, nullable])),
          discriminator: 'type',
          variants: { Bug: 'bug' },
        },
        Bug: {
          fields: Object.keys(bugFields),
          storedAs: bugFields,
          types: Object.fromEntries(Object.keys(bugFields).map((field) => [field, nullable])),
          base: 'Task',
        },
      },
      { tasks: {} },
    );

  it('offers no temporary stored name a variant of the model already holds', () => {
    const [conflict] = refused(
      plan({
        from: tasks('from', { p: 'a', q: 'b' }, { sev: 'prisma_swap_b' }),
        to: tasks('to', { p: 'b', q: 'a' }, { sev: 'prisma_swap_b' }),
        schema: [schemaCollection('tasks')],
      }),
    );
    expect(conflict?.why).toContain('"prisma_swap_b_"');
  });

  it('refuses a rename onto the stored name another root model of the collection keeps', () => {
    expect(
      refused(plan({ from: shared('from', 'x'), to: shared('to', 'y'), schema: usersSchema })),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "x" to "y" in collection "users": the documents already hold field "y"',
        why: 'The stored name of field "User.a" changes from "x" to "y", and the documents already hold field "y", the stored name of field "Admin.b". Without the rename the plan would read the values of field "y" as values of field "User.a". Make the change in two plans: first remove field "Admin.b", or keep it and change its stored name (@map) to a name neither contract uses, such as "prisma_swap_y", or another if the documents already hold a field of that name, and plan and apply that; then make this change and plan again.',
      },
    ]);
  });

  it('refuses a base field rename onto the stored name of a variant field the destination removes, naming that field', () => {
    expect(
      refused(
        plan({
          from: tasks('from', { a: 'x' }, { b: 'y' }),
          to: tasks('to', { a: 'y' }, {}),
          schema: [schemaCollection('tasks')],
        }),
      ),
    ).toEqual([
      {
        kind: 'unsupportedOperation',
        summary:
          'Cannot rename field "x" to "y" in collection "tasks": the documents already hold field "y"',
        why: 'The stored name of field "Task.a" changes from "x" to "y", and the documents already hold field "y", the stored name of field "Bug.b". Without the rename the plan would read the values of field "y" as values of field "Task.a". Make the change in two plans: first remove field "Bug.b", or keep it and change its stored name (@map) to a name neither contract uses, such as "prisma_swap_y", or another if the documents already hold a field of that name, and plan and apply that; then make this change and plan again.',
      },
    ]);
  });

  it('follows the route: moves the field of the other model to a name nothing uses, then renames', () => {
    const admin = (seed: string, b: string, a: string) =>
      contract(
        seed,
        {
          Admin: {
            collection: 'users',
            fields: ['_id', 'b'],
            storedAs: { b },
            types: { b: nullable },
          },
          User: {
            collection: 'users',
            fields: ['_id', 'a'],
            storedAs: { a },
            types: { a: nullable },
          },
        },
        { users: {} },
      );
    expect([
      planned(
        plan({
          from: admin('s0', 'y', 'x'),
          to: admin('s1', 'prisma_swap_y', 'x'),
          schema: usersSchema,
        }),
      ).labels,
      planned(
        plan({
          from: admin('s1', 'prisma_swap_y', 'x'),
          to: admin('s2', 'prisma_swap_y', 'y'),
          schema: usersSchema,
        }),
      ).labels,
    ]).toEqual([
      ['Rename field y to prisma_swap_y in collection users'],
      ['Rename field x to y in collection users'],
    ]);
  });

  it('follows the route: removes the variant field, then renames the base field', () => {
    const live = [schemaCollection('tasks')];
    expect([
      planned(
        plan({
          from: tasks('s0', { a: 'x' }, { b: 'y' }),
          to: tasks('s1', { a: 'x' }, {}),
          schema: live,
        }),
      ),
      planned(
        plan({ from: tasks('s1', { a: 'x' }, {}), to: tasks('s2', { a: 'y' }, {}), schema: live }),
      ),
    ]).toEqual([
      {
        labels: ['Remove field y from collection tasks in documents whose type is "bug"'],
        classes: ['destructive'],
        applied: [],
        dataLoss: [
          {
            operationIndex: 0,
            subject: { kind: 'field', namespaceId: NS, model: 'Bug', field: 'b' },
            loss: 'drop',
            label: 'Remove field y from collection tasks in documents whose type is "bug"',
          },
        ],
      },
      {
        labels: ['Rename field x to y in collection tasks'],
        classes: ['widening'],
        applied: [],
        dataLoss: [],
      },
    ]);
  });
});

describe('MongoMigrationPlanner, variant field renames whose documents never meet', () => {
  const nullable = { codecId: 'mongo/string@1', nullable: true };
  const typed = (fields: Readonly<Record<string, string>>) =>
    Object.fromEntries(Object.keys(fields).map((field) => [field, nullable]));
  const tasks = (
    seed: string,
    bug: Readonly<Record<string, string>>,
    epic: Readonly<Record<string, string>>,
  ) =>
    contract(
      seed,
      {
        Task: {
          collection: 'tasks',
          fields: ['_id', 'type'],
          discriminator: 'type',
          variants: { Bug: 'bug', Epic: 'epic' },
        },
        Bug: { fields: Object.keys(bug), storedAs: bug, types: typed(bug), base: 'Task' },
        Epic: { fields: Object.keys(epic), storedAs: epic, types: typed(epic), base: 'Task' },
      },
      { tasks: {} },
    );

  it("plans a variant field rename beside another variant's statement that takes its old key", () => {
    expect(
      planned(
        plan({
          from: tasks('from', { a: 'x' }, { c: 'z' }),
          to: tasks('to', { a: 'y' }, { d: 'x' }),
          schema: [schemaCollection('tasks')],
          statements: [renameField('Epic', 'c', 'Epic', 'd')],
        }),
      ),
    ).toEqual({
      labels: [
        'Rename field z to x in collection tasks in documents whose type is "epic"',
        'Rename field x to y in collection tasks in documents whose type is "bug"',
      ],
      classes: ['widening', 'widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });
});

describe('MongoMigrationPlanner, a field rename statement in a shared collection the origin leaves external and the destination manages', () => {
  const from = contract(
    'from',
    {
      Admin: { collection: 'people', fields: ['_id', 'name'] },
      User: { collection: 'people', fields: ['_id', 'name'] },
    },
    { people: { control: 'external' } },
  );
  const to = contract(
    'to',
    {
      Admin: { collection: 'people', fields: ['_id', 'name'], storedAs: { name: 'n' } },
      User: { collection: 'people', fields: ['_id', 'n'] },
    },
    { people: { control: 'managed' } },
  );

  it("plans one rename, which also renames the other model's field, and asks nothing about that field", () => {
    expect(
      planned(
        plan({
          from,
          to,
          schema: [schemaCollection('people')],
          statements: [renameField('User', 'name', 'User', 'n')],
        }),
      ),
    ).toEqual({
      labels: ['Rename field name to n in collection people'],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('does not take the statement call as renaming the field of a model that leaves the collection, and asks about that field', () => {
    const leaving = contract(
      'to',
      {
        Admin: { collection: 'admins', fields: ['_id', 'name'], storedAs: { name: 'n' } },
        User: { collection: 'people', fields: ['_id', 'n'] },
      },
      { people: { control: 'managed' }, admins: { control: 'managed' } },
    );
    expect(
      planned(
        plan({
          from,
          to: leaving,
          schema: [schemaCollection('people')],
          statements: [renameField('User', 'name', 'User', 'n')],
        }),
      ),
    ).toEqual({
      labels: [
        'Create collection admins',
        'Rename field name to n in collection people',
        'Remove field name from collection people',
      ],
      classes: ['additive', 'widening', 'destructive'],
      applied: [[1]],
      dataLoss: [
        {
          operationIndex: 2,
          subject: { kind: 'field', namespaceId: NS, model: 'Admin', field: 'name' },
          loss: 'drop',
          label: 'Remove field name from collection people',
        },
      ],
    });
  });

  it("does not take a variant's statement call, which renames only that variant's documents, as renaming the other variant's field", () => {
    const nullable = { codecId: 'mongo/string@1', nullable: true };
    const typed = (fields: Readonly<Record<string, string>>) =>
      Object.fromEntries(Object.keys(fields).map((field) => [field, nullable]));
    const tasks = (
      seed: string,
      control: 'external' | 'managed',
      bug: Readonly<Record<string, string>>,
      epic: Readonly<Record<string, string>>,
    ) =>
      contract(
        seed,
        {
          Task: {
            collection: 'tasks',
            fields: ['_id', 'type'],
            discriminator: 'type',
            variants: { Bug: 'bug', Epic: 'epic' },
          },
          Bug: { fields: Object.keys(bug), storedAs: bug, types: typed(bug), base: 'Task' },
          Epic: { fields: Object.keys(epic), storedAs: epic, types: typed(epic), base: 'Task' },
        },
        { tasks: { control } },
      );
    expect(
      planned(
        plan({
          from: tasks('from', 'external', { a: 'x' }, { c: 'x' }),
          to: tasks('to', 'managed', { a: 'y' }, { d: 'y' }),
          schema: [schemaCollection('tasks')],
          statements: [renameField('Epic', 'c', 'Epic', 'd')],
        }),
      ),
    ).toEqual({
      labels: [
        'Rename field x to y in collection tasks in documents whose type is "epic"',
        'Remove field x from collection tasks in documents whose type is "bug"',
      ],
      classes: ['widening', 'destructive'],
      applied: [[0]],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'field', namespaceId: NS, model: 'Bug', field: 'a' },
          loss: 'drop',
          label: 'Remove field x from collection tasks in documents whose type is "bug"',
        },
      ],
    });
  });

  it('does not take the statement call in one collection as renaming the same stored name in another collection', () => {
    const both = (seed: string, control: 'external' | 'managed', user: string, item: string) =>
      contract(
        seed,
        {
          User: { collection: 'people', fields: ['_id', user] },
          Item: { collection: 'items', fields: ['_id', 'name'], storedAs: { name: item } },
        },
        { people: { control }, items: { control } },
      );
    expect(
      planned(
        plan({
          from: both('from', 'external', 'name', 'name'),
          to: both('to', 'managed', 'n', 'n'),
          schema: [schemaCollection('people'), schemaCollection('items')],
          statements: [renameField('User', 'name', 'User', 'n')],
        }),
      ),
    ).toEqual({
      labels: [
        'Rename field name to n in collection people',
        'Remove field name from collection items',
      ],
      classes: ['widening', 'destructive'],
      applied: [[0]],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'field', namespaceId: NS, model: 'Item', field: 'name' },
          loss: 'drop',
          label: 'Remove field name from collection items',
        },
      ],
    });
  });
});
