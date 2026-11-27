import { describe, expect, it } from 'vitest';
import { contract, plan, refusal, renameModel, schemaCollection } from './mongo-statement-fixtures';

const EVENT = { collection: 'events', fields: ['_id', 'name'] };
const LIMITS =
  'Collection "measurements" is a time-series collection, which a $merge stage cannot write into, and an $out stage replaces everything it holds.';
const MOVE_LIMITS =
  'Stop writes to each collection the documents move out of until the apply succeeds, re-runs included: the delete also removes a document of those models written there after the copy, and that document was not copied.';
const OUT_LIMITS =
  'Stop writes to collection "measurements" too, for the whole apply, re-runs included: an $out stage replaces the collection with what it read, so a document written there while the copy runs is lost. An $out stage cannot write into a sharded collection.';

function rerun(from: string): string {
  return `The copy has no check, so it runs again on every run of the migration, and a run after the delete has finished writes back what collection "measurements" already holds. If the apply stops after the copy and before the delete has finished, finish that delete yourself, on collection "${from}" with the same filter, before you run db migrate again: otherwise the copy adds the documents still in collection "${from}" to collection "measurements" a second time. Do not delete documents from collection "measurements" instead: a time-series collection does not enforce a unique _id, so a delete by _id there can also remove a document it already held.`;
}

function unionText(moving: string): string {
  return `${LIMITS} So its run reads the documents collection "measurements" holds, adds those of ${moving} with a $unionWith stage, and writes them all back with an $out stage, which rewrites the whole collection:`;
}

function routeOf(result: ReturnType<typeof plan>): string {
  return refusal(result)[0]?.why ?? '';
}

function shape(why: string) {
  const paragraphs = why.split('\n\n');
  return {
    copies: why.match(/ {2}rawAggregate\([\s\S]*?\n {2}\]\)/g) ?? [],
    unions: paragraphs.filter((paragraph) => paragraph.includes(`${LIMITS} So its run reads`)),
    reruns: paragraphs.filter((paragraph) => paragraph.startsWith('The copy has no check')),
    limits: paragraphs.find((paragraph) => paragraph.startsWith(MOVE_LIMITS)),
    apply: paragraphs.find((paragraph) => paragraph.includes('emit its ops.json')),
  };
}

const ONE_RUN = 'Run that migration.ts to emit its ops.json, and apply it with db migrate.';

describe('MongoMigrationPlanner, a document move into a time-series collection', () => {
  it('reads the collection into the $out copy even when the plan creates it', () => {
    const why = routeOf(
      plan({
        from: contract(
          'from',
          { Event: EVENT, Measurement: { collection: 'events', fields: ['_id', 'at'] } },
          { events: {} },
        ),
        to: contract(
          'to',
          { Event: EVENT, Reading: { collection: 'measurements', fields: ['_id', 'at'] } },
          { events: {}, measurements: { timeField: 'at' } },
        ),
        schema: [schemaCollection('events')],
        statements: [renameModel('Measurement', 'Reading')],
      }),
    );
    expect(shape(why)).toEqual({
      copies: [
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only those documents> }] } },\n    { $out: "measurements" },\n  ])',
      ],
      unions: [expect.stringContaining(unionText('model "Measurement"'))],
      reruns: [rerun('events')],
      limits: `${MOVE_LIMITS} ${OUT_LIMITS}`,
      apply: ONE_RUN,
    });
  });

  it('reads the collection into the $out copy on the variant route too', () => {
    const task = (variants: Readonly<Record<string, string>>) => ({
      collection: 'tasks',
      fields: ['_id', 'type'],
      discriminator: 'type',
      variants,
    });
    const feat = { Feat: { collection: 'tasks', fields: ['area'], base: 'Task' } };
    const why = routeOf(
      plan({
        from: contract(
          'from',
          {
            Reading: { collection: 'tasks', fields: ['_id', 'type', 'at'] },
            Task: task({ Bug: 'bug', Feat: 'feat' }),
            Bug: { collection: 'tasks', fields: ['sev'], base: 'Task' },
            ...feat,
          },
          { tasks: {} },
        ),
        to: contract(
          'to',
          {
            Reading: { collection: 'measurements', fields: ['_id', 'type', 'at'] },
            Task: task({ Feat: 'feat' }),
            ...feat,
          },
          { tasks: {}, measurements: { timeField: 'at' } },
        ),
        schema: [schemaCollection('tasks')],
      }),
    );
    expect(shape(why)).toEqual({
      copies: [
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "tasks", pipeline: [{ $match: <a filter that selects only those documents> }] } },\n    { $out: "measurements" },\n  ])',
      ],
      unions: [expect.stringContaining(unionText('model "Reading"'))],
      reruns: [rerun('tasks')],
      limits: `${MOVE_LIMITS} ${OUT_LIMITS}`,
      apply: ONE_RUN,
    });
  });

  it('reads the collection into the $out copy when it exists before the move', () => {
    const why = routeOf(
      plan({
        from: contract(
          'from',
          { Event: EVENT, Measurement: { collection: 'events', fields: ['_id', 'at'] } },
          { events: {}, measurements: { timeField: 'at' } },
        ),
        to: contract(
          'to',
          { Event: EVENT, Reading: { collection: 'measurements', fields: ['_id', 'at'] } },
          { events: {}, measurements: { timeField: 'at' } },
        ),
        schema: [
          schemaCollection('events'),
          schemaCollection('measurements', { timeseries: true }),
        ],
        statements: [renameModel('Measurement', 'Reading')],
      }),
    );
    expect(shape(why)).toEqual({
      copies: [
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only those documents> }] } },\n    { $out: "measurements" },\n  ])',
      ],
      unions: [expect.stringContaining(unionText('model "Measurement"'))],
      reruns: [rerun('events')],
      limits: `${MOVE_LIMITS} ${OUT_LIMITS}`,
      apply: ONE_RUN,
    });
  });

  it('writes one $out for all the copies of one collection when there are several, and a delete for each', () => {
    const why = routeOf(
      plan({
        from: contract(
          'from',
          {
            Event: EVENT,
            Measurement: { collection: 'events', fields: ['_id', 'at', 'x'] },
            Sample: { collection: 'events', fields: ['_id', 'at'] },
          },
          { events: {} },
        ),
        to: contract(
          'to',
          {
            Event: EVENT,
            Reading: { collection: 'measurements', fields: ['_id', 'at'] },
            Probe: { collection: 'measurements', fields: ['_id', 'at'] },
          },
          { events: {}, measurements: { timeField: 'at' } },
        ),
        schema: [schemaCollection('events')],
        statements: [renameModel('Measurement', 'Reading'), renameModel('Sample', 'Probe')],
      }),
    );
    expect(shape(why)).toEqual({
      copies: [
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only the documents of model "Measurement"> }, { $unset: ["x"] }] } },\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only the documents of model "Sample"> }] } },\n    { $out: "measurements" },\n  ])',
      ],
      unions: [expect.stringContaining(unionText('models "Measurement" and "Sample"'))],
      reruns: [
        'The copy has no check, so it runs again on every run of the migration, and a run after the deletes have finished writes back what collection "measurements" already holds. If the apply stops after the copy and before the deletes have finished, finish them yourself, on collection "events", each with its stage\'s filter, before you run db migrate again: otherwise the copy adds the documents still in collection "events" to collection "measurements" a second time. Do not delete documents from collection "measurements" instead: a time-series collection does not enforce a unique _id, so a delete by _id there can also remove a document it already held.',
      ],
      limits: `${MOVE_LIMITS} ${OUT_LIMITS}`,
      apply: ONE_RUN,
    });
    expect(why).toContain(
      'After it, add the operations that delete the documents of models "Measurement" and "Sample" from collection "events", one for each $unionWith stage, with that stage\'s filter:\n\n  deleteDocuments({ collection: "events", filter: <the filter of the $unionWith stage of model "Measurement"> })\n  deleteDocuments({ collection: "events", filter: <the filter of the $unionWith stage of model "Sample"> })\n\n',
    );
  });

  it('gives each source collection its own $out copy when documents of two collections move into one', () => {
    const why = routeOf(
      plan({
        from: contract(
          'from',
          {
            Event: EVENT,
            Measurement: { collection: 'events', fields: ['_id', 'at'] },
            Log: { collection: 'logs', fields: ['_id', 'line'] },
            Sample: { collection: 'logs', fields: ['_id', 'at'] },
          },
          { events: {}, logs: {} },
        ),
        to: contract(
          'to',
          {
            Event: EVENT,
            Log: { collection: 'logs', fields: ['_id', 'line'] },
            Reading: { collection: 'measurements', fields: ['_id', 'at'] },
            Probe: { collection: 'measurements', fields: ['_id', 'at'] },
          },
          { events: {}, logs: {}, measurements: { timeField: 'at' } },
        ),
        schema: [schemaCollection('events'), schemaCollection('logs')],
        statements: [renameModel('Measurement', 'Reading'), renameModel('Sample', 'Probe')],
      }),
    );
    expect(shape(why)).toEqual({
      copies: [
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only those documents> }] } },\n    { $out: "measurements" },\n  ])',
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "logs", pipeline: [{ $match: <a filter that selects only those documents> }] } },\n    { $out: "measurements" },\n  ])',
      ],
      unions: [
        expect.stringContaining(unionText('model "Measurement"')),
        expect.stringContaining(unionText('model "Sample"')),
      ],
      reruns: [rerun('events'), rerun('logs')],
      limits: `${MOVE_LIMITS} ${OUT_LIMITS}`,
      apply:
        'Both dataTransforms go in that one migration.ts. Run it to emit its ops.json, and apply it once with db migrate.',
    });
  });

  it('says on the hand-written route that the collection is time-series', () => {
    const why = routeOf(
      plan({
        from: contract(
          'from',
          {
            User: { collection: 'users', fields: ['_id', 'at'] },
            Account: { collection: 'accounts', fields: ['_id', 'at'] },
          },
          { users: {}, accounts: {} },
        ),
        to: contract(
          'to',
          {
            User: { collection: 'measurements', fields: ['_id', 'at'] },
            Member: { collection: 'measurements', fields: ['_id', 'at'] },
          },
          { measurements: { timeField: 'at' } },
        ),
        schema: [schemaCollection('users'), schemaCollection('accounts')],
        statements: [renameModel('Account', 'Member')],
      }),
    );
    expect({
      copies: why.split('rawAggregate(').length - 1,
      route: why.split('\n\n').at(-1),
    }).toEqual({
      copies: 0,
      route: `With migration plan, write this change as a hand-written migration instead: run prisma migration new, and in the operations of the migration.ts it writes, rewrite the documents of model "Account", and those of model "User" that collection "measurements" does not already hold, into collection "measurements" yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json. ${LIMITS}`,
    });
  });
});
