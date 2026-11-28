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

/** Tasks discriminated by `type`, `Bug` and `Epic` stored in the base's collection unless given their own. */
function tasks(
  seed: string,
  options: {
    readonly collection?: string;
    readonly bug?: Partial<ModelSpec> & { readonly name?: string };
    readonly collections?: readonly string[];
  } = {},
) {
  const collection = options.collection ?? 'tasks';
  const bug = options.bug?.name ?? 'Bug';
  return contract(
    seed,
    {
      Task: {
        collection,
        fields: ['_id', 'type'],
        discriminator: 'type',
        variants: { [bug]: 'bug', Epic: 'epic' },
      },
      [bug]: { fields: ['severity'], base: 'Task', ...options.bug },
      Epic: { fields: ['scope'], base: 'Task' },
    },
    Object.fromEntries([collection, ...(options.collections ?? [])].map((name) => [name, {}])),
  );
}

const liveTasks = [schemaCollection('tasks')];

const LEAVE_OUT_SHARED = (statements: string, moving: string) =>
  `\n\nLeave out ${statements} to plan the change without moving them. The plan then asks about the data of ${moving}, which it drops. Its question offers this same rename again, which is refused again for the same reason. Answer it with --delete, which it also offers: that plans the change and deletes the data.\n\n`;

describe('MongoMigrationPlanner, a collection that variants share with their base', () => {
  it('renames the collection once when the base changes @@map and the variants follow', () => {
    expect(
      planned(
        plan({
          from: tasks('from'),
          to: tasks('to', { collection: 'work_items' }),
          schema: liveTasks,
        }),
      ),
    ).toEqual({
      labels: ['Rename collection tasks to work_items'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('renames the collection once for a base rename statement whose variants follow by their names', () => {
    const to = contract(
      'to',
      {
        WorkItem: {
          collection: 'work_items',
          fields: ['_id', 'type'],
          discriminator: 'type',
          variants: { Bug: 'bug', Epic: 'epic' },
        },
        Bug: { fields: ['severity'], base: 'WorkItem' },
        Epic: { fields: ['scope'], base: 'WorkItem' },
      },
      { work_items: {} },
    );
    expect(
      planned(
        plan({
          from: tasks('from'),
          to,
          schema: liveTasks,
          statements: [renameModel('Task', 'WorkItem')],
        }),
      ),
    ).toEqual({
      labels: ['Rename collection tasks to work_items'],
      classes: ['widening'],
      applied: [[0]],
      dataLoss: [],
    });
  });

  it('pairs a variant renamed without a statement by its storage once the collection is renamed', () => {
    expect(
      planned(
        plan({
          from: tasks('from'),
          to: tasks('to', { collection: 'work_items', bug: { name: 'Defect' } }),
          schema: liveTasks,
        }),
      ),
    ).toEqual({
      labels: ['Rename collection tasks to work_items'],
      classes: ['widening'],
      applied: [],
      dataLoss: [],
    });
  });

  it('renames the collection when the destination removes a variant, and deletes and asks about its documents', () => {
    const to = contract(
      'to',
      {
        Task: {
          collection: 'work_items',
          fields: ['_id', 'type'],
          discriminator: 'type',
          variants: { Epic: 'epic' },
        },
        Epic: { fields: ['scope'], base: 'Task' },
      },
      { work_items: {} },
    );
    const deleted = 'Delete the documents of collection work_items whose type is "bug"';
    expect(planned(plan({ from: tasks('from'), to, schema: liveTasks }))).toEqual({
      labels: ['Rename collection tasks to work_items', deleted],
      classes: ['widening', 'destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 1,
          subject: { kind: 'model', namespaceId: NS, model: 'Bug' },
          loss: 'drop',
          label: deleted,
        },
      ],
    });
  });

  it('renames nothing when a variant gains a collection of its own', () => {
    const result = plan({
      from: tasks('from'),
      to: tasks('to', { bug: { collection: 'bugs' }, collections: ['bugs'] }),
      schema: liveTasks,
    });
    expect(planned(result)).toEqual({
      labels: ['Create collection bugs'],
      classes: ['additive'],
      applied: [],
      dataLoss: [],
    });
  });

  it("renames nothing when a variant's own collection folds back into its base's", () => {
    const result = plan({
      from: tasks('from', { bug: { collection: 'bugs' }, collections: ['bugs'] }),
      to: tasks('to'),
      schema: [...liveTasks, schemaCollection('bugs')],
    });
    expect(planned(result)).toEqual({
      labels: ['Drop collection bugs'],
      classes: ['destructive'],
      applied: [],
      dataLoss: [
        {
          operationIndex: 0,
          subject: { kind: 'model', namespaceId: NS, model: 'Bug' },
          loss: 'drop',
          label: 'Drop collection bugs',
        },
      ],
    });
  });

  it("refuses a model rename statement that would move the documents of the other models in the variant's collection", () => {
    const statement = renameModel('Bug', 'Defect');
    const result = plan({
      from: tasks('from'),
      to: tasks('to', {
        bug: { name: 'Defect', collection: 'defects' },
        collections: ['defects'],
      }),
      schema: liveTasks,
      statements: [statement],
    });
    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "Bug" to "Defect": collection "tasks" also stores models "Task" and "Epic"',
          why: `A collection rename moves every document of the collection, and the documents of models "Task" and "Epic" do not move to collection "defects". Moving the documents of one model out of a collection it shares with others is a data migration, which a plan does not write.${LEAVE_OUT_SHARED('--rename Bug:Defect', 'model "Bug"')}With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "Bug" into collection "defects" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`,
          refusedStatement: statement,
        },
      ],
    });
  });

  it('refuses a model rename statement whose new collection already stores the documents of other models', () => {
    const statement = renameModel('Bug', 'Defect');
    const result = plan({
      from: tasks('from', { bug: { collection: 'bugs' }, collections: ['bugs'] }),
      to: tasks('to', { bug: { name: 'Defect' } }),
      schema: [...liveTasks, schemaCollection('bugs')],
      statements: [statement],
    });
    expect(result).toEqual({
      kind: 'failure',
      conflicts: [
        {
          kind: 'statementRefused',
          summary:
            'Cannot rename model "Bug" to "Defect": collection "tasks" also stores models "Task" and "Epic", whose documents are not in collection "bugs"',
          why: `A collection rename moves the documents of one collection, and collection "tasks" would also store the documents of models "Task" and "Epic". Moving the documents of two collections into one is a data migration, which a plan does not write.${LEAVE_OUT_SHARED('--rename Bug:Defect', 'model "Bug"')}With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "Bug" into collection "tasks" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`,
          refusedStatement: statement,
        },
      ],
    });
  });
});
