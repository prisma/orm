import { describe, expect, it } from 'vitest';
import { contract, NS, plan, planned, schemaCollection } from './mongo-statement-fixtures';

const live = [schemaCollection('people')];
const types = { status: { codecId: 'mongo/string@1', valueSet: 'Status' } };
const REPLACED = {
  labels: [
    'Create collection members',
    'Replace value "active" with "act" in field status of collection people',
  ],
  classes: ['additive', 'widening'],
  applied: [],
  dataLoss: [],
};

describe('MongoMigrationPlanner, a root model that moves out of a collection it shares, beside a rewrite of the model that stays', () => {
  it('blocks no field rename of the model that stays', () => {
    const from = contract(
      'from',
      {
        Admin: { collection: 'people', fields: ['_id', 'name'] },
        User: { collection: 'people', fields: ['_id', 'name'] },
      },
      { people: {} },
    );
    const to = contract(
      'to',
      {
        Admin: { collection: 'people', fields: ['_id', 'name'], storedAs: { name: 'n' } },
        User: { collection: 'members', fields: ['_id', 'name'] },
      },
      { people: {}, members: {} },
    );
    expect(planned(plan({ from, to, schema: live }))).toEqual({
      labels: ['Create collection members', 'Rename field name to n in collection people'],
      classes: ['additive', 'widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('blocks no stored value replacement of the model that stays, in a field both hold or only it holds', () => {
    const shared = (seed: string, user: string, value: string, userFields: readonly string[]) =>
      contract(
        seed,
        {
          Admin: { collection: 'people', fields: ['_id', 'status'], types },
          User: { collection: user, fields: ['_id', ...userFields], types },
        },
        Object.fromEntries([...new Set(['people', user])].map((name) => [name, {}])),
        {},
        { Status: { members: { ACTIVE: value } } },
      );
    expect({
      both: planned(
        plan({
          from: shared('from', 'people', 'active', ['status']),
          to: shared('to', 'members', 'act', ['status']),
          schema: live,
        }),
      ),
      adminOnly: planned(
        plan({
          from: shared('from', 'people', 'active', ['name']),
          to: shared('to', 'members', 'act', ['name']),
          schema: live,
        }),
      ),
    }).toEqual({
      both: REPLACED,
      adminOnly: REPLACED,
    });
  });
});

describe('MongoMigrationPlanner, a field rename onto the stored name of a field of a root model the destination removes', () => {
  const from = contract(
    'from',
    {
      Admin: { collection: 'people', fields: ['_id', 'nick'] },
      User: { collection: 'people', fields: ['_id', 'name'] },
    },
    { people: {} },
  );
  const to = contract(
    'to',
    { User: { collection: 'people', fields: ['_id', 'name'], storedAs: { name: 'nick' } } },
    { people: {} },
  );

  it('is refused, saying that removing the model does not free the name', () => {
    expect(plan({ from, to, schema: live })).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename field "name" to "nick" in collection "people": the documents already hold field "nick"',
          why: 'The stored name of field "User.name" changes from "name" to "nick", and the documents already hold field "nick", the stored name of field "Admin.nick". Without the rename the plan would read the values of field "nick" as values of field "User.name". Make the change in two plans: first keep model "Admin" and remove field "Admin.nick", or keep it and change its stored name (@map) to a name neither contract uses, such as "prisma_swap_nick", or another if the documents already hold a field of that name, and plan and apply that, which frees the name in the documents; then make this change and plan again. Removing model "Admin" does not free the name: it plans nothing, and its key stays in the documents. Or keep the stored name "name" of field "User.name" in the contract.',
        },
      ],
    });
  });

  it('follows the route: keeping the model and removing its field unsets the key and asks, and then the rename is planned', () => {
    const step = contract(
      'step',
      {
        Admin: { collection: 'people', fields: ['_id'] },
        User: { collection: 'people', fields: ['_id', 'name'] },
      },
      { people: {} },
    );
    const final = contract(
      'final',
      {
        Admin: { collection: 'people', fields: ['_id'] },
        User: { collection: 'people', fields: ['_id', 'name'], storedAs: { name: 'nick' } },
      },
      { people: {} },
    );
    expect({
      first: planned(plan({ from, to: step, schema: live })),
      second: planned(plan({ from: step, to: final, schema: live })),
    }).toEqual({
      first: {
        labels: ['Remove field nick from collection people'],
        classes: ['destructive'],
        applied: [],
        dataLoss: [
          {
            operationIndex: 0,
            subject: { kind: 'field', namespaceId: NS, model: 'Admin', field: 'nick' },
            loss: 'drop',
            label: 'Remove field nick from collection people',
          },
        ],
      },
      second: {
        labels: ['Rename field name to nick in collection people'],
        classes: ['widening'],
        applied: [],
        dataLoss: [],
      },
    });
  });
});

describe('MongoMigrationPlanner, a variant rewrite in a collection whose other root model the destination removes', () => {
  const task = (variants: Readonly<Record<string, string>>) => ({
    collection: 'tasks',
    fields: ['_id', 'type'],
    discriminator: 'type',
    variants,
  });
  const from = contract(
    'from',
    {
      Admin: { collection: 'tasks', fields: ['_id', 'type'] },
      Task: task({ Bug: 'bug', Feat: 'feat' }),
      Bug: { collection: 'tasks', fields: ['sev'], base: 'Task' },
      Feat: { collection: 'tasks', fields: ['area'], base: 'Task' },
    },
    { tasks: {} },
  );
  const tasks = [schemaCollection('tasks')];
  const destination = (
    admin: boolean,
    variants: Readonly<Record<string, string>>,
    defect = false,
  ) =>
    contract(
      'to',
      {
        ...(admin ? { Admin: { collection: 'tasks', fields: ['_id', 'type'] } } : {}),
        Task: task(variants),
        ...(defect ? { Bug: { collection: 'tasks', fields: ['sev'], base: 'Task' } } : {}),
        Feat: { collection: 'tasks', fields: ['area'], base: 'Task' },
      },
      { tasks: {} },
    );

  it('plans the delete of a removed variant, asked about, when the other root model is removed, and refuses it when that model stays', () => {
    expect({
      removed: planned(plan({ from, to: destination(false, { Feat: 'feat' }), schema: tasks })),
      kept: plan({ from, to: destination(true, { Feat: 'feat' }), schema: tasks }),
    }).toEqual({
      removed: {
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
      kept: {
        kind: 'failure',
        conflicts: [
          {
            kind: 'unsupportedOperation',
            summary:
              'Cannot delete the documents of variant "Bug": the documents of model "Admin" in collection "tasks" can hold type "bug"',
            why: 'Collection "tasks" stores several models and no discriminator tells their documents apart, so deleting the documents with that value would delete the documents of "Admin" too. To change only the documents of variant "Bug", move the models to separate collections, or keep variant "Bug" in the contract.',
          },
        ],
      },
    });
  });

  it('plans the replacement of a changed discriminator value when the other root model is removed, and refuses it when that model stays', () => {
    const convert = [
      { kind: 'convert', entity: 'model', model: { namespaceId: NS, model: 'Bug' } } as const,
    ];
    expect({
      removed: planned(
        plan({
          from,
          to: destination(false, { Bug: 'defect', Feat: 'feat' }, true),
          schema: tasks,
          statements: convert,
        }),
      ),
      kept: plan({
        from,
        to: destination(true, { Bug: 'defect', Feat: 'feat' }, true),
        schema: tasks,
        statements: convert,
      }),
    }).toEqual({
      removed: {
        labels: ['Replace value "bug" with "defect" in field type of collection tasks'],
        classes: ['widening'],
        applied: [[0]],
        dataLoss: [],
      },
      kept: {
        kind: 'failure',
        conflicts: [
          {
            kind: 'statementRefused',
            summary:
              'Cannot convert variant "Bug": the documents of model "Admin" in collection "tasks" can hold type "bug"',
            why: 'Collection "tasks" stores several models and no discriminator tells their documents apart, so replacing the value would replace it in the documents of "Admin" too. To change only the documents of variant "Bug", move the models to separate collections, or carry out the change yourself, with a filter that selects only their documents, in a dataTransform operation of the migration.ts that migration plan writes or in mongosh.',
            refusedStatement: convert[0],
          },
        ],
      },
    });
  });

  it('refuses the delete and the replacement when the other root model moves to a collection of its own, since its documents stay', () => {
    const moved = (variants: Readonly<Record<string, string>>, defect: boolean) =>
      contract(
        'to',
        {
          Admin: { collection: 'admins', fields: ['_id', 'type'] },
          Task: task(variants),
          ...(defect ? { Bug: { collection: 'tasks', fields: ['sev'], base: 'Task' } } : {}),
          Feat: { collection: 'tasks', fields: ['area'], base: 'Task' },
        },
        { tasks: {}, admins: {} },
      );
    const convert = [
      { kind: 'convert', entity: 'model', model: { namespaceId: NS, model: 'Bug' } } as const,
    ];
    expect({
      deleted: plan({ from, to: moved({ Feat: 'feat' }, false), schema: tasks }),
      converted: plan({
        from,
        to: moved({ Bug: 'defect', Feat: 'feat' }, true),
        schema: tasks,
        statements: convert,
      }),
    }).toEqual({
      deleted: {
        kind: 'failure',
        conflicts: [
          {
            kind: 'unsupportedOperation',
            summary:
              'Cannot delete the documents of variant "Bug": the documents of model "Admin" in collection "tasks" can hold type "bug"',
            why: 'Collection "tasks" stores several models and no discriminator tells their documents apart, so deleting the documents with that value would delete the documents of "Admin" too. A model that moves out of collection "tasks" leaves its documents in it, so make the change in two plans. First move model "Admin" to collection "admins", keep variant "Bug" as it is, and plan that with migration plan. Write that first contract as this one with variant "Bug" kept, so its plan changes collection "admins" as this plan does, which the steps below expect.\n\nIn the operations of the migration.ts it writes, right after the creation of collection "admins" and before the plan\'s own operations on collection "tasks", add a dataTransform. Its run copies the documents of model "Admin" into collection "admins":\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "admins" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "Admin" from collection "tasks":\n\n  deleteDocuments({ collection: "tasks", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "tasks", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "Admin" stores. If it stores none, no field tells its documents apart: select them by their _id values instead.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nStop writes to each collection the documents move out of until the apply ends: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, retries included: a document written there after the check could hold the _id of a document that moves.\n\nIf the apply stops, fix what stopped it and run db migrate again.\n\nUnder db update, first stop writes to collection "tasks", then move the documents of model "Admin" out of it by hand, then apply that change, and allow writes again only once it is applied: a document of model "Admin" written there after the copy would not be moved. Applied before the move, the change can stop at the new validator of collection "tasks", which need not accept those documents.\n\nThen make the change to variant "Bug" and plan again. Or keep variant "Bug" in the contract.',
          },
        ],
      },
      converted: {
        kind: 'failure',
        conflicts: [
          {
            kind: 'statementRefused',
            summary:
              'Cannot convert variant "Bug": the documents of model "Admin" in collection "tasks" can hold type "bug"',
            why: 'Collection "tasks" stores several models and no discriminator tells their documents apart, so replacing the value would replace it in the documents of "Admin" too. A model that moves out of collection "tasks" leaves its documents in it, so make the change in two plans. First move model "Admin" to collection "admins", keep variant "Bug" as it is, and plan that with migration plan. Write that first contract as this one with variant "Bug" kept, so its plan changes collection "admins" as this plan does, which the steps below expect.\n\nIn the operations of the migration.ts it writes, right after the creation of collection "admins" and before the plan\'s own operations on collection "tasks", add a dataTransform. Its run copies the documents of model "Admin" into collection "admins":\n\n  rawAggregate("tasks", [\n    { $match: <a filter that selects only those documents> },\n    { $merge: { into: "admins" } },\n  ])\n\nAfter it, add the operation that deletes the documents of model "Admin" from collection "tasks":\n\n  deleteDocuments({ collection: "tasks", filter: <the same filter> })\n\nThe filter must tell those documents apart from the other documents of collection "tasks", which can hold the same values in the fields they share, a discriminator value among them. Filter by a field only model "Admin" stores. If it stores none, no field tells its documents apart: select them by their _id values instead.\n\nRun that migration.ts to emit its ops.json, and apply it with db migrate.\n\nStop writes to each collection the documents move out of until the apply ends: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, retries included: a document written there after the check could hold the _id of a document that moves.\n\nIf the apply stops, fix what stopped it and run db migrate again.\n\nUnder db update, first stop writes to collection "tasks", then move the documents of model "Admin" out of it by hand, then apply that change, and allow writes again only once it is applied: a document of model "Admin" written there after the copy would not be moved. Applied before the move, the change can stop at the new validator of collection "tasks", which need not accept those documents.\n\nThen make the change to variant "Bug" and plan again. Or keep the discriminator value "bug" in the contract.',
            refusedStatement: convert[0],
          },
        ],
      },
    });
  });
});

describe('MongoMigrationPlanner, a field rename onto the stored name of a variant field whose root model the destination removes', () => {
  const from = contract(
    'from',
    {
      Admin: {
        collection: 'people',
        fields: ['_id', 'kind'],
        discriminator: 'kind',
        variants: { Boss: 'boss' },
      },
      Boss: { collection: 'people', fields: ['nick'], base: 'Admin' },
      User: { collection: 'people', fields: ['_id', 'name'] },
    },
    { people: {} },
  );
  const to = contract(
    'to',
    { User: { collection: 'people', fields: ['_id', 'name'], storedAs: { name: 'nick' } } },
    { people: {} },
  );

  it('is refused, naming the root model whose removal does not free the name', () => {
    expect(plan({ from, to, schema: live })).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'unsupportedOperation',
          summary:
            'Cannot rename field "name" to "nick" in collection "people": the documents already hold field "nick"',
          why: 'The stored name of field "User.name" changes from "name" to "nick", and the documents already hold field "nick", the stored name of field "Boss.nick". Without the rename the plan would read the values of field "nick" as values of field "User.name". Make the change in two plans: first keep model "Admin" and remove field "Boss.nick", or keep it and change its stored name (@map) to a name neither contract uses, such as "prisma_swap_nick", or another if the documents already hold a field of that name, and plan and apply that, which frees the name in the documents; then make this change and plan again. Removing model "Admin" does not free the name: it plans nothing, and its key stays in the documents. Or keep the stored name "name" of field "User.name" in the contract.',
        },
      ],
    });
  });

  it('follows the route: keeping the root model and removing the field unsets the key and asks, and then the rename is planned', () => {
    const step = contract(
      'step',
      {
        Admin: {
          collection: 'people',
          fields: ['_id', 'kind'],
          discriminator: 'kind',
          variants: { Boss: 'boss' },
        },
        Boss: { collection: 'people', fields: [], base: 'Admin' },
        User: { collection: 'people', fields: ['_id', 'name'] },
      },
      { people: {} },
    );
    const final = contract(
      'final',
      {
        Admin: {
          collection: 'people',
          fields: ['_id', 'kind'],
          discriminator: 'kind',
          variants: { Boss: 'boss' },
        },
        Boss: { collection: 'people', fields: [], base: 'Admin' },
        User: { collection: 'people', fields: ['_id', 'name'], storedAs: { name: 'nick' } },
      },
      { people: {} },
    );
    expect({
      first: planned(plan({ from, to: step, schema: live })),
      second: planned(plan({ from: step, to: final, schema: live })),
    }).toEqual({
      first: {
        labels: ['Remove field nick from collection people in documents whose kind is "boss"'],
        classes: ['destructive'],
        applied: [],
        dataLoss: [
          {
            operationIndex: 0,
            subject: { kind: 'field', namespaceId: NS, model: 'Boss', field: 'nick' },
            loss: 'drop',
            label: 'Remove field nick from collection people in documents whose kind is "boss"',
          },
        ],
      },
      second: {
        labels: ['Rename field name to nick in collection people'],
        classes: ['widening'],
        applied: [],
        dataLoss: [],
      },
    });
  });
});
