import { describe, expect, it } from 'vitest';
import { contract, NS, plan, planned, schemaCollection } from './mongo-statement-fixtures';

const tasks = [schemaCollection('tasks')];
const task = (variants: Readonly<Record<string, string>>, extra: object = {}) => ({
  collection: 'tasks',
  fields: ['_id', 'type'],
  discriminator: 'type',
  variants,
  ...extra,
});
const variants = (bug: boolean) => ({
  ...(bug ? { Bug: { collection: 'tasks', fields: ['sev'], base: 'Task' } } : {}),
  Feat: { collection: 'tasks', fields: ['area'], base: 'Task' },
});

describe('MongoMigrationPlanner, a variant change beside a root model that moves out of the collection', () => {
  const from = contract(
    'from',
    {
      Admin: { collection: 'tasks', fields: ['_id', 'type'] },
      Task: task({ Bug: 'bug', Feat: 'feat' }),
      ...variants(true),
    },
    { tasks: {} },
  );

  it('follows the two-plan route: the move with the variant kept, then the variant change, which is planned and asked about', () => {
    const step = contract(
      'step',
      {
        Admin: { collection: 'admins', fields: ['_id', 'type'] },
        Task: task({ Bug: 'bug', Feat: 'feat' }),
        ...variants(true),
      },
      { tasks: {}, admins: {} },
    );
    const final = contract(
      'final',
      {
        Admin: { collection: 'admins', fields: ['_id', 'type'] },
        Task: task({ Feat: 'feat' }),
        ...variants(false),
      },
      { tasks: {}, admins: {} },
    );
    expect({
      together: plan({ from, to: final, schema: tasks }).kind,
      first: planned(plan({ from, to: step, schema: tasks })),
      second: planned(
        plan({ from: step, to: final, schema: [...tasks, schemaCollection('admins')] }),
      ),
    }).toEqual({
      together: 'failure',
      first: {
        labels: ['Create collection admins'],
        classes: ['additive'],
        applied: [],
        dataLoss: [],
      },
      second: {
        labels: ['Delete the documents of collection tasks whose type is "bug"'],
        classes: ['destructive'],
        applied: [],
        dataLoss: [
          {
            operationIndex: 0,
            subject: { kind: 'model', namespaceId: NS, model: 'Bug' },
            loss: 'drop',
            label: 'Delete the documents of collection tasks whose type is "bug"',
          },
        ],
      },
    });
  });

  it('gives the advice for the model that stays as well, when one moves out and another stays', () => {
    const withGuest = contract(
      'from',
      {
        Admin: { collection: 'tasks', fields: ['_id', 'type'] },
        Guest: { collection: 'tasks', fields: ['_id', 'type'] },
        Task: task({ Bug: 'bug', Feat: 'feat' }),
        ...variants(true),
      },
      { tasks: {} },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'admins', fields: ['_id', 'type'] },
        Guest: { collection: 'tasks', fields: ['_id', 'type'] },
        Task: task({ Feat: 'feat' }),
        ...variants(false),
      },
      { tasks: {}, admins: {} },
    );
    expect(plan({ from: withGuest, to, schema: tasks })).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot delete the documents of variant "Bug": the documents of models "Admin" and "Guest" in collection "tasks" can hold type "bug"',
          why: 'Collection "tasks" stores several models and no discriminator tells their documents apart, so deleting the documents with that value would delete the documents of "Admin" and "Guest" too. To change only the documents of variant "Bug", move the models to separate collections, or keep variant "Bug" in the contract. Model "Admin" also moves out of collection "tasks" but leaves its documents in it, so that move goes in a plan of its own before this change. First move model "Admin" to collection "admins", keep variant "Bug" as it is, and plan that with migration plan. Write that first contract as this one with variant "Bug" kept, so its plan changes collection "admins" as this plan does, which the steps below expect.\n\nIn the operations of the migration.ts it writes, right after the creation of collection "admins" and before the plan\'s own operations on collection "tasks", add a dataTransform. Its run copies the documents of model "Admin" into collection "admins":\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "admins" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "Admin" from collection "tasks":\n\n  deleteDocuments({ collection: "tasks", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "tasks", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "Admin" stores.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nIf the apply stops, fix what stopped it and run db migrate again.\n\nUnder db update, first move the documents of model "Admin" out of collection "tasks" by hand, then apply that change. Applied before the move, the change can stop at the new validator of collection "tasks", which need not accept those documents.',
        },
      ],
    });
  });

  it('names a replacement, not a delete, when an enum value rename moves the discriminator value', () => {
    const kindType = { types: { type: { codecId: 'mongo/string@1', valueSet: 'Kind' } } };
    const world = (seed: string, admin: string, bugValue: string, member: string) =>
      contract(
        seed,
        {
          Admin: { collection: admin, fields: ['_id', 'type'] },
          Task: task({ Bug: bugValue, Feat: 'feat' }, kindType),
          ...variants(true),
        },
        admin === 'tasks' ? { tasks: {} } : { tasks: {}, admins: {} },
        {},
        { Kind: { members: { [member]: bugValue, FEAT: 'feat' } } },
      );
    const result = plan({
      from: world('from', 'tasks', 'bug', 'BUG'),
      to: world('to', 'admins', 'defect', 'DEFECT'),
      schema: tasks,
      statements: [
        {
          kind: 'rename',
          entity: 'enumValue',
          from: { namespaceId: NS, enum: 'Kind', member: 'BUG' },
          to: { namespaceId: NS, enum: 'Kind', member: 'DEFECT' },
        },
      ],
    });
    expect(
      result.kind === 'failure' ? result.conflicts.map(({ summary }) => summary) : result,
    ).toEqual([
      'Cannot replace the discriminator value "bug" of variant "Bug": the documents of model "Admin" in collection "tasks" can hold type "bug"',
    ]);
  });

  it('puts the move first when the model moves into a collection that already exists', () => {
    const world = (seed: string, admin: string, bug: boolean) =>
      contract(
        seed,
        {
          Admin: { collection: admin, fields: ['_id', 'type'] },
          Guest: { collection: 'people', fields: ['_id', 'type'] },
          Task: task(bug ? { Bug: 'bug', Feat: 'feat' } : { Feat: 'feat' }),
          ...variants(bug),
        },
        { tasks: {}, people: {} },
      );
    expect(
      plan({
        from: world('from', 'tasks', true),
        to: world('to', 'people', false),
        schema: [...tasks, schemaCollection('people')],
      }),
    ).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot delete the documents of variant "Bug": the documents of model "Admin" in collection "tasks" can hold type "bug"',
          why: 'Collection "tasks" stores several models and no discriminator tells their documents apart, so deleting the documents with that value would delete the documents of "Admin" too. A model that moves out of collection "tasks" leaves its documents in it, so make the change in two plans. First move model "Admin" to collection "people", keep variant "Bug" as it is, and plan that with migration plan. Write that first contract as this one with variant "Bug" kept, so its plan changes collection "people" as this plan does, which the steps below expect.\n\nAt the start of the operations of the migration.ts it writes, before the plan\'s own operations on collection "tasks", add a dataTransform. Its run copies the documents of model "Admin" into collection "people":\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "people" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "Admin" from collection "tasks":\n\n  deleteDocuments({ collection: "tasks", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "tasks", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "Admin" stores.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nIf the apply stops, fix what stopped it and run db migrate again.\n\nUnder db update, first move the documents of model "Admin" out of collection "tasks" by hand, then apply that change. Applied before the move, the change can stop at the new validator of collection "tasks", which need not accept those documents.\n\nThen make the change to variant "Bug" and plan again. Or keep variant "Bug" in the contract.',
        },
      ],
    });
  });
});
