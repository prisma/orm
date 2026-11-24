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
            'Cannot delete the documents of variant "Bug": the documents of model "Admin", "Guest" in collection "tasks" can hold type "bug"',
          why: 'Collection "tasks" stores several models and no discriminator tells their documents apart, so deleting the documents with that value would delete the documents of "Admin", "Guest" too. To change only the documents of variant "Bug", move the models to separate collections, or keep variant "Bug" in the contract. Model "Admin" also moves out of collection "tasks" but leaves its documents in it, so that move goes in a plan of its own before this change: first move model "Admin" to its new collection and keep variant "Bug" as it is, plan and apply that, and move the documents of model "Admin" out of collection "tasks": in the migration.ts that migration plan writes, right after the creation of the new collection, or by hand under db update.',
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
});
