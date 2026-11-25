import { describe, expect, it } from 'vitest';
import { contract, plan, refusal, renameModel, schemaCollection } from './mongo-statement-fixtures';

const EVENT = { collection: 'events', fields: ['_id', 'name'] };
const LIMITS =
  'Collection "measurements" is a time-series collection, which a $merge stage cannot write into, and an $out stage replaces everything it holds.';
const OUT_LIMITS =
  'Stop writes to collection "measurements" too, from before the apply until it ends, retries included: an $out stage replaces a document written there before it runs.';
const UNION_RERUN =
  'If the apply stops after the copy and before the delete, delete the moved documents from collection "measurements" before you run db migrate again: the copy runs again, and the collection would then hold them twice.';

function routeOf(result: ReturnType<typeof plan>): string {
  return refusal(result)[0]?.why ?? '';
}

function shape(why: string) {
  return {
    copies: why.match(/ {2}rawAggregate\([\s\S]*?\n {2}\]\)/g) ?? [],
    merges: why.includes('$merge: {'),
    limits: why.includes(LIMITS),
    outLimits: why.includes(OUT_LIMITS),
    rerun: why.includes(UNION_RERUN),
  };
}

describe('MongoMigrationPlanner, a document move into a time-series collection', () => {
  it('copies with $out when the plan creates the collection and the copy is the only one into it', () => {
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
    expect({
      ...shape(why),
      why: why.includes(
        `${LIMITS} So the copy ends in an $out stage: the plan creates collection "measurements" right before it with the time-series options of the contract, and no other copy writes into it, so the $out replaces nothing and keeps those options.`,
      ),
    }).toEqual({
      copies: [
        '  rawAggregate("events", [\n    { $match: <a filter that selects only those documents> },\n    { $out: "measurements" },\n  ])',
      ],
      merges: false,
      limits: true,
      outLimits: true,
      rerun: false,
      why: true,
    });
  });

  it('copies with $out on the variant route too', () => {
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
        '  rawAggregate("tasks", [\n    { $match: <a filter that selects only those documents> },\n    { $out: "measurements" },\n  ])',
      ],
      merges: false,
      limits: true,
      outLimits: true,
      rerun: false,
    });
  });

  it('reads the documents the collection holds into the $out when it exists before the move', () => {
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
    expect({
      ...shape(why),
      why: why.includes(
        `${LIMITS} Collection "measurements" holds documents when the move runs, which an $out stage alone would remove. So its run reads the documents collection "measurements" holds, adds those of model "Measurement" with a $unionWith stage, and writes them all back with an $out stage:`,
      ),
    }).toEqual({
      copies: [
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only those documents> }] } },\n    { $out: "measurements" },\n  ])',
      ],
      merges: false,
      limits: true,
      outLimits: true,
      rerun: true,
      why: true,
    });
  });

  it('writes one $out for all the copies into a new collection when there are several', () => {
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
    expect({
      ...shape(why),
      why: why.includes(
        `${LIMITS} More than one copy writes into collection "measurements", and an $out stage in each would remove what the one before it wrote.`,
      ),
      apply: why.includes(
        'Run that migration.ts to emit its ops.json, and apply it with db migrate.',
      ),
    }).toEqual({
      copies: [
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only the documents of model "Measurement"> }, { $unset: ["x"] }] } },\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only the documents of model "Sample"> }] } },\n    { $out: "measurements" },\n  ])',
      ],
      merges: false,
      limits: true,
      outLimits: true,
      rerun: true,
      why: true,
      apply: true,
    });
  });
});
