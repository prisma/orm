import { MongoCollection } from '@internal/mongo-contract';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { contract, NS, useStatementsDatabase } from './runner-statements-fixtures';

const live = useStatementsDatabase('runner_statements_variants_test');

function branchSchema(value: string, fields: readonly string[]) {
  return {
    properties: Object.fromEntries([
      ['_id', { bsonType: 'objectId' }],
      ['type', { enum: [value] }],
      ...fields.map((field) => [field, { bsonType: 'string' }]),
    ]),
    required: ['type'],
    additionalProperties: false,
  };
}

function tasksValidator(base: readonly string[], bug: readonly string[]) {
  return {
    bsonType: 'object',
    required: ['_id', 'type'],
    properties: Object.fromEntries([
      ['_id', { bsonType: 'objectId' }],
      ['type', { bsonType: 'string' }],
      ...base.map((field) => [field, { bsonType: 'string' }]),
    ]),
    oneOf: [branchSchema('bug', [...base, ...bug]), branchSchema('feature', [...base, 'priority'])],
  };
}

function tasks(storageHash: string, base: readonly string[], bug: readonly string[]) {
  return contract(
    storageHash,
    {
      Task: {
        collection: 'tasks',
        fields: ['_id', 'type', ...base],
        variants: { Bug: 'bug', Feature: 'feature' },
      },
      Bug: { collection: 'tasks', fields: bug, base: 'Task' },
      Feature: { collection: 'tasks', fields: ['priority'], base: 'Task' },
    },
    {
      tasks: new MongoCollection({
        validator: {
          jsonSchema: tasksValidator(base, bug),
          validationLevel: 'strict',
          validationAction: 'error',
        },
      }),
    },
  );
}

async function createTasksWithNote(): Promise<void> {
  await live.db().createCollection('tasks', {
    validator: { $jsonSchema: tasksValidator(['note'], []) },
    validationLevel: 'strict',
    validationAction: 'error',
  });
  await live
    .db()
    .collection('tasks')
    .insertMany([
      { type: 'bug', note: 'b' },
      { type: 'feature', note: 'f' },
    ]);
}

describe('MongoMigrationPlanner and runner - statements on variants', () => {
  it(
    "renames a variant's field only in its own documents, so another variant's field of that name keeps its values",
    async () => {
      await live
        .db()
        .collection('tasks')
        .insertMany([
          { type: 'bug', score: 3 },
          { type: 'feature', score: 5 },
        ]);
      const tasks = (storageHash: string, bugField: string) =>
        contract(
          storageHash,
          {
            Task: {
              collection: 'tasks',
              fields: ['_id', 'type'],
              variants: { Bug: 'bug', Feature: 'feature' },
            },
            Bug: { collection: 'tasks', fields: [bugField], base: 'Task' },
            Feature: { collection: 'tasks', fields: ['score'], base: 'Task' },
          },
          { tasks: new MongoCollection({}) },
        );

      const { result } = await live.planAndRun(tasks('from', 'score'), tasks('to', 'severity'), [
        {
          kind: 'rename',
          entity: 'field',
          from: { namespaceId: NS, model: 'Bug', field: 'score' },
          to: { namespaceId: NS, model: 'Bug', field: 'severity' },
        },
      ]);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(1);
      expect(await live.documents('tasks')).toEqual([
        { type: 'bug', severity: 3 },
        { type: 'feature', score: 5 },
      ]);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'removes a base field moved to one variant from the documents of every other variant',
    async () => {
      await createTasksWithNote();
      const to = tasks('to', [], ['note']);

      const { planned, result } = await live.planAndRun(tasks('from', ['note'], []), to);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(2);
      expect(planned.kind === 'success' ? planned.dataLoss : undefined).toEqual([
        {
          operationIndex: 0,
          subject: { kind: 'field', namespaceId: NS, model: 'Task', field: 'note' },
          label: 'Remove field note from collection tasks in documents whose type is not "bug"',
          loss: 'drop',
        },
      ]);
      expect({
        tasks: await live.documents('tasks'),
        further: await live.furtherPlanLabels(to),
      }).toEqual({
        tasks: [{ type: 'bug', note: 'b' }, { type: 'feature' }],
        further: [],
      });
      await expect(
        live
          .db()
          .collection('tasks')
          .updateOne({ type: 'feature' }, { $set: { priority: 'p1' } }),
      ).resolves.toMatchObject({ modifiedCount: 1 });
      await expect(
        live
          .db()
          .collection('tasks')
          .updateOne({ type: 'bug' }, { $set: { note: 'b2' } }),
      ).resolves.toMatchObject({ modifiedCount: 1 });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'renames a base field moved to one variant only in the documents of the other variants',
    async () => {
      await createTasksWithNote();
      const to = tasks('to', ['remark'], ['note']);

      const { result } = await live.planAndRun(tasks('from', ['note'], []), to, [
        {
          kind: 'rename',
          entity: 'field',
          from: { namespaceId: NS, model: 'Task', field: 'note' },
          to: { namespaceId: NS, model: 'Task', field: 'remark' },
        },
      ]);

      expect(result.ok ? result.value.operationsExecuted : result.failure).toBe(2);
      expect({
        tasks: await live.documents('tasks'),
        further: await live.furtherPlanLabels(to),
      }).toEqual({
        tasks: [
          { type: 'bug', note: 'b' },
          { type: 'feature', remark: 'f' },
        ],
        further: [],
      });
      await expect(
        live
          .db()
          .collection('tasks')
          .updateOne({ type: 'feature' }, { $set: { priority: 'p1' } }),
      ).resolves.toMatchObject({ modifiedCount: 1 });
      await expect(
        live
          .db()
          .collection('tasks')
          .updateOne({ type: 'bug' }, { $set: { note: 'b2' } }),
      ).resolves.toMatchObject({ modifiedCount: 1 });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
