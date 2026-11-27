import { introspectSchema } from '@internal/adapter-mongo/control';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import { MongoCollection } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { dataTransform, deleteDocuments, rawAggregate } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
import { type Document, ObjectId } from 'mongodb';
import { describe, expect, it } from 'vitest';
import { outInterruptingClient } from './out-interruption-proxy';
import { contract, NS, useStatementsDatabase } from './runner-statements-fixtures';

const live = useStatementsDatabase('runner_statements_time_series_moves_test');

const policy: MigrationOperationPolicy = {
  allowedOperationClasses: ['additive', 'widening', 'destructive', 'data'],
};

const at = new Date('2026-01-01T00:00:00Z');
const event = { collection: 'events', fields: ['_id', 'name'] };
const from = contract(
  'from',
  { Event: event, Measurement: { collection: 'events', fields: ['_id', 'at'] } },
  { events: new MongoCollection({}) },
);
const to = contract(
  'to',
  { Event: event, Reading: { collection: 'measurements', fields: ['_id', 'at'] } },
  {
    events: new MongoCollection({}),
    measurements: new MongoCollection({ options: { timeseries: { timeField: 'at' } } }),
  },
);
const filter = { at: { $exists: true } };
const copy = dataTransform('move Measurement documents to measurements', {
  run: () =>
    rawAggregate('measurements', [
      { $unionWith: { coll: 'events', pipeline: [{ $match: filter }] } },
      { $out: 'measurements' },
    ]),
});
const deletion = deleteDocuments({ collection: 'events', filter });
const LOOKUP = `{"$lookup":{"from":"measurements","localField":"_id","foreignField":"_id","let":{"copied":"$$ROOT"},"pipeline":[{"$match":{"$expr":{"$setEquals":[{"$objectToArray":"$$ROOT"},{"$objectToArray":"$$copied"}]}}}],"as":"inTarget"}},{"$match":{"inTarget":{"$ne":[]}}},{"$project":{"_id":1}}`;
const AFTER_LISTING = (source: string) =>
  `Delete only the listed documents from collection ${source} yourself, by their _id, then run the command again. A document that is not listed was not copied, or changed after the copy: the run copies it, and if collection measurements already holds its earlier form under the same _id, it then holds both, so delete the earlier one there yourself. A document whose copied form is identical to one collection measurements already held is listed as copied: its content is there under the same _id, so deleting it loses only a second identical copy. If you must keep such identical documents, keep collection ${source} as it is and reconcile the two collections by hand.`;
const STOPPED = `Writes to collections measurements and events must still be stopped: that delete also removes any document written to collection events since the copy, which the copy did not take. If you cannot be sure that nothing wrote to either collection since the apply stopped, keep collection events as it is and compare the two collections: a document of collection events that the copy's $match filter selects was copied when collection measurements holds, whole and under the same _id, the document the copy's stages make of it. List those with db.getCollection("events").aggregate([{"$match":{"at":{"$exists":true}}},${LOOKUP}]) in mongosh. ${AFTER_LISTING('events')} Otherwise`;
const failing = dataTransform('an operation that fails', {
  run: () => rawAggregate('events', [{ $nonsenseStage: 1 }]),
});

async function planFor(statements: Parameters<MongoMigrationPlanner['plan']>[0]['statements']) {
  return new MongoMigrationPlanner().plan({
    contract: to,
    schema: await introspectSchema(live.db()),
    policy,
    fromContract: from,
    origin: { storageHash: 'from' },
    statements,
    frameworkComponents: [],
    snapshotsImportPath: '../../snapshots',
  });
}

/** The plan without the statement, split where the refusal says the copy and the delete go: right after the creation of collection measurements. */
async function routeAround(): Promise<{
  readonly route: string | undefined;
  readonly before: readonly AnyMongoMigrationOperation[];
  readonly after: readonly AnyMongoMigrationOperation[];
}> {
  await live
    .db()
    .collection('events')
    .insertMany([{ name: 'launch' }, { at, value: 1 }, { at, value: 2 }]);
  await live.initMarker(from);
  const refused = await planFor([
    {
      kind: 'rename',
      entity: 'model',
      from: { namespaceId: NS, model: 'Measurement' },
      to: { namespaceId: NS, model: 'Reading' },
    },
  ]);
  const planned = await planFor([]);
  if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
  const operations = planned.plan.operations as readonly AnyMongoMigrationOperation[];
  const create = operations.findIndex((operation) => operation.label.includes('measurements'));
  return {
    route: refused.kind === 'failure' ? refused.conflicts[0]?.why : undefined,
    before: operations.slice(0, create + 1),
    after: operations.slice(create + 1),
  };
}

/** Runs each query the failure prints to list the copied documents, and deletes the listed documents from their collection by _id, as the failure says. */
async function deleteListed(advice: string | undefined): Promise<number> {
  const printed = new Set(
    [
      ...(advice ?? '').matchAll(
        /db\.getCollection\("[^"]+"\)\.aggregate\(\[.*?\{"\$project":\{"_id":1\}\}\]\)/g,
      ),
    ].map(([query]) => query),
  );
  let deleted = 0;
  for (const query of printed) {
    const [, collection = '', pipeline = '[]'] =
      /^db\.getCollection\("([^"]+)"\)\.aggregate\((.*)\)$/.exec(query) ?? [];
    const source = live.db().collection(collection);
    const listed = await source.aggregate(JSON.parse(pipeline)).toArray();
    const result = await source.deleteMany({ _id: { $in: listed.map(({ _id }) => _id) } });
    deleted += result.deletedCount;
  }
  return deleted;
}

async function state() {
  return {
    measurements: await live.documents('measurements'),
    kind: (await live.db().listCollections({ name: 'measurements' }).toArray())[0]?.['type'],
    events: await live.documents('events'),
    further: await live.furtherPlanLabels(to),
  };
}

const moved = {
  measurements: [
    { at, value: 1 },
    { at, value: 2 },
  ],
  kind: 'timeseries',
  events: [{ name: 'launch' }],
  further: [],
};

describe('MongoMigrationPlanner and runner - a move into a new time-series collection', () => {
  it(
    'keeps every moved document once when the apply stops after the delete and runs again',
    async () => {
      const { route, before, after } = await routeAround();
      expect(route).toContain(
        '  rawAggregate("measurements", [\n    { $unionWith: { coll: "events", pipeline: [{ $match: <a filter that selects only those documents> }] } },\n    { $out: "measurements" },\n  ])',
      );

      const first = await live.runOperations(
        [...before, copy, deletion, failing, ...after],
        from,
        to,
        { policy },
      );
      const second = await live.runOperations([...before, copy, deletion, ...after], from, to, {
        policy,
      });

      expect({
        first: first.ok ? 'applied' : 'stopped',
        second: second.ok ? 'applied' : second.failure,
        ...(await state()),
      }).toEqual({ first: 'stopped', second: 'applied', ...moved });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'keeps every moved document once when the apply stops between the copy and the delete, and the delete is finished as the failure says',
    async () => {
      const { before, after } = await routeAround();

      const first = await live.runOperations(
        [...before, copy, failing, deletion, ...after],
        from,
        to,
        { policy },
      );
      const advice = first.ok ? undefined : first.failure.why;
      await live.db().collection('events').deleteMany(filter);
      const second = await live.runOperations([...before, copy, deletion, ...after], from, to, {
        policy,
      });

      expect({
        advice,
        second: second.ok ? 'applied' : second.failure,
        ...(await state()),
      }).toEqual({
        advice: expect.stringContaining(
          `Operation data_transform.move Measurement documents to measurements copied documents into collection measurements with an $out stage, and operation ${deletion.id}, which deletes them from collection events, has not finished. ${STOPPED}, before you run the command again, finish that delete yourself, on collection events with the filter of its deleteDocuments call in the migration's migration.ts`,
        ),
        second: 'applied',
        ...moved,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationPlanner and runner - a move into a time-series collection whose copy loses its connection', () => {
  /**
   * Plans the move, creates collection measurements as the plan's create would, with a document
   * whose _id an events document also has, and runs the copy and the rest of the plan through a
   * connection that drops at the copy's $out request.
   */
  async function interruptedCopy(
    mode: 'beforeCommit' | 'afterCommit',
    { through = copy, held = [] }: { through?: AnyMongoMigrationOperation; held?: Document[] } = {},
  ) {
    const { before, after } = await routeAround();
    const overlapping = await live.db().collection('events').findOne({ value: 1 });
    if (overlapping === null) throw new Error('The events document with value 1 is missing');
    await live.db().createCollection('measurements', { timeseries: { timeField: 'at' } });
    await live
      .db()
      .collection('measurements')
      .insertMany([{ _id: overlapping._id, at, value: 0 }, ...held]);
    const setUp = before.filter((operation) => !operation.label.includes('measurements'));
    const proxy = await outInterruptingClient(live.uri(), mode);
    try {
      const first = await live.runOperations([...setUp, through, deletion, ...after], from, to, {
        policy,
        client: proxy.client,
      });
      return {
        advice: first.ok ? undefined : first.failure.why,
        count: await live.db().collection('measurements').countDocuments(),
        rerun: [...setUp, through, deletion, ...after],
      };
    } finally {
      await proxy.close();
    }
  }

  const counts = `Before the copy, collection measurements held 1 document, and the copy was to add 2 documents of collection events. To tell whether it finished, count the documents of collection measurements, for example with db.getCollection("measurements").countDocuments() in mongosh. If it holds 3, the copy finished. ${STOPPED}, before you run the command again, run that delete yourself`;

  it(
    'says to delete nothing when the copy stopped before its $out committed, though the target already holds an _id of the source',
    async () => {
      const { advice, count, rerun } = await interruptedCopy('beforeCommit');
      const second = await live.runOperations(rerun, from, to, { policy });

      expect({
        advice,
        count,
        second: second.ok ? 'applied' : second.failure,
        measurements: await live.documents('measurements'),
        events: await live.documents('events'),
      }).toEqual({
        advice: expect.stringContaining(
          `${counts}, on collection events with the filter of its deleteDocuments call in the migration's migration.ts. The copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If it holds 1, the copy did not finish: delete nothing, and run the command again as it is.`,
        ),
        count: 1,
        second: 'applied',
        measurements: expect.arrayContaining([
          { at, value: 0 },
          { at, value: 1 },
          { at, value: 2 },
        ]),
        events: [{ name: 'launch' }],
      });
      expect(await live.documents('measurements')).toHaveLength(3);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'keeps a document written to the source after the stop, when the collections are compared as the failure says',
    async () => {
      const { advice, count, rerun } = await interruptedCopy('afterCommit');
      await live.db().collection('events').insertOne({ at, value: 3 });
      const deleted = await deleteListed(advice);
      const second = await live.runOperations(rerun, from, to, { policy });

      expect({
        advice,
        count,
        deleted,
        second: second.ok ? 'applied' : second.failure,
        measurements: await live.documents('measurements'),
        events: await live.documents('events'),
      }).toEqual({
        advice: expect.stringContaining(`If it holds 3, the copy finished. ${STOPPED}`),
        count: 3,
        deleted: 2,
        second: 'applied',
        measurements: expect.arrayContaining([
          { at, value: 0 },
          { at, value: 1 },
          { at, value: 2 },
          { at, value: 3 },
        ]),
        events: [{ name: 'launch' }],
      });
      expect(await live.documents('measurements')).toHaveLength(4);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'keeps a change made after the stop to a field the copy renames, when the collections are compared as the failure says',
    async () => {
      const renaming = dataTransform('move Measurement documents to measurements', {
        run: () =>
          rawAggregate('measurements', [
            {
              $unionWith: {
                coll: 'events',
                pipeline: [
                  { $match: filter },
                  { $set: { reading: '$value' } },
                  { $unset: ['value'] },
                ],
              },
            },
            { $out: 'measurements' },
          ]),
      });
      const { advice, rerun } = await interruptedCopy('afterCommit', { through: renaming });
      await live
        .db()
        .collection('events')
        .updateOne({ value: 2 }, { $set: { value: 20 } });
      const deleted = await deleteListed(advice);
      const second = await live.runOperations(rerun, from, to, { policy });
      const measurements = live.db().collection('measurements');
      const updated = await measurements.findOne({ reading: 20 });
      if (updated === null) throw new Error('The re-run did not copy the updated document');
      await measurements.deleteOne({ _id: updated._id, reading: 2 });

      expect({
        query: advice,
        deleted,
        second: second.ok ? 'applied' : second.failure,
        measurements: await live.documents('measurements'),
        events: await live.documents('events'),
      }).toEqual({
        query: expect.stringContaining(
          `List those with db.getCollection("events").aggregate([{"$match":{"at":{"$exists":true}}},{"$set":{"reading":"$value"}},{"$unset":["value"]},${LOOKUP}]) in mongosh.`,
        ),
        deleted: 1,
        second: 'applied',
        measurements: expect.arrayContaining([
          { at, value: 0 },
          { at, reading: 1 },
          { at, reading: 20 },
        ]),
        events: [{ name: 'launch' }],
      });
      expect(await live.documents('measurements')).toHaveLength(3);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'counts as copied a source document identical to one the target already held, so its content stays in the target once',
    async () => {
      const held = { _id: new ObjectId(), at, value: 9 };
      const { advice, rerun } = await interruptedCopy('afterCommit', { held: [held] });
      await live.db().collection('events').insertOne(held);
      const deleted = await deleteListed(advice);
      const second = await live.runOperations(rerun, from, to, { policy });

      expect({
        advice,
        deleted,
        second: second.ok ? 'applied' : second.failure,
        measurements: await live.documents('measurements'),
        events: await live.documents('events'),
      }).toEqual({
        advice: expect.stringContaining(
          'A document whose copied form is identical to one collection measurements already held is listed as copied: its content is there under the same _id, so deleting it loses only a second identical copy. If you must keep such identical documents, keep collection events as it is and reconcile the two collections by hand.',
        ),
        deleted: 3,
        second: 'applied',
        measurements: expect.arrayContaining([
          { at, value: 0 },
          { at, value: 1 },
          { at, value: 2 },
          { at, value: 9 },
        ]),
        events: [{ name: 'launch' }],
      });
      expect(await live.documents('measurements')).toHaveLength(4);
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'says the copy finished when the connection dropped after its $out committed',
    async () => {
      const { advice, count, rerun } = await interruptedCopy('afterCommit');
      await live.db().collection('events').deleteMany(filter);
      const second = await live.runOperations(rerun, from, to, { policy });

      expect({
        advice,
        count,
        second: second.ok ? 'applied' : second.failure,
        measurements: await live.documents('measurements'),
        events: await live.documents('events'),
      }).toEqual({
        advice: expect.stringContaining(counts),
        count: 3,
        second: 'applied',
        measurements: expect.arrayContaining([
          { at, value: 0 },
          { at, value: 1 },
          { at, value: 2 },
        ]),
        events: [{ name: 'launch' }],
      });
      expect(await live.documents('measurements')).toHaveLength(3);
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationPlanner and runner - a move of two groups of models into one time-series collection', () => {
  const groupsFrom = contract(
    'from',
    {
      Event: event,
      Measurement: { collection: 'events', fields: ['_id', 'at'] },
      Sample: { collection: 'events', fields: ['_id', 'at'] },
    },
    { events: new MongoCollection({}) },
  );
  const groupsTo = contract(
    'to',
    {
      Event: event,
      Reading: { collection: 'measurements', fields: ['_id', 'at'] },
      Probe: { collection: 'measurements', fields: ['_id', 'at'] },
    },
    {
      events: new MongoCollection({}),
      measurements: new MongoCollection({ options: { timeseries: { timeField: 'at' } } }),
    },
  );
  const measurementFilter = { value: { $exists: true } };
  const sampleFilter = { probe: { $exists: true } };
  const groupsCopy = dataTransform('move Measurement and Sample documents to measurements', {
    run: () =>
      rawAggregate('measurements', [
        { $unionWith: { coll: 'events', pipeline: [{ $match: measurementFilter }] } },
        { $unionWith: { coll: 'events', pipeline: [{ $match: sampleFilter }] } },
        { $out: 'measurements' },
      ]),
  });
  const measurementDeletion = deleteDocuments({ collection: 'events', filter: measurementFilter });
  const sampleDeletion = deleteDocuments({ collection: 'events', filter: sampleFilter });

  it(
    'keeps every moved document once when the apply stops between the copy and the deletes, and the deletes are finished as the failure says',
    async () => {
      await live
        .db()
        .collection('events')
        .insertMany([{ name: 'launch' }, { at, value: 1 }, { at, probe: 'p1' }]);
      await live.initMarker(groupsFrom);
      const planned = await new MongoMigrationPlanner().plan({
        contract: groupsTo,
        schema: await introspectSchema(live.db()),
        policy,
        fromContract: groupsFrom,
        origin: { storageHash: 'from' },
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
      const operations = planned.plan.operations as readonly AnyMongoMigrationOperation[];
      const create = operations.findIndex((operation) => operation.label.includes('measurements'));
      const before = operations.slice(0, create + 1);
      const after = operations.slice(create + 1);
      const deletes = [measurementDeletion, sampleDeletion];

      const first = await live.runOperations(
        [...before, groupsCopy, failing, ...deletes, ...after],
        groupsFrom,
        groupsTo,
        { policy },
      );
      const advice = first.ok ? undefined : first.failure.why;
      await live.db().collection('events').deleteMany(measurementFilter);
      await live.db().collection('events').deleteMany(sampleFilter);
      const second = await live.runOperations(
        [...before, groupsCopy, ...deletes, ...after],
        groupsFrom,
        groupsTo,
        { policy },
      );

      expect({
        advice,
        second: second.ok ? 'applied' : second.failure,
        measurements: await live.documents('measurements'),
        events: await live.documents('events'),
        further: await live.furtherPlanLabels(groupsTo),
      }).toEqual({
        advice: expect.stringContaining(
          `Operation ${groupsCopy.id} copied documents into collection measurements with an $out stage, and operations ${measurementDeletion.id} and ${sampleDeletion.id}, which delete them from collection events, have not finished. Writes to collections measurements and events must still be stopped: those deletes also remove any document written to collection events since the copy, which the copy did not take. If you cannot be sure that nothing wrote to either collection since the apply stopped, keep collection events as it is and compare the two collections: a document of collection events that one of the copy's $match filters selects was copied when collection measurements holds, whole and under the same _id, the document the copy's stages make of it. List those with db.getCollection("events").aggregate([{"$match":{"value":{"$exists":true}}},${LOOKUP}]) and db.getCollection("events").aggregate([{"$match":{"probe":{"$exists":true}}},${LOOKUP}]), one query for each $unionWith stage of the copy, in mongosh. ${AFTER_LISTING('events')} Otherwise, before you run the command again, finish those deletes yourself`,
        ),
        second: 'applied',
        measurements: [
          { at, value: 1 },
          { at, probe: 'p1' },
        ],
        events: [{ name: 'launch' }],
        further: [],
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationPlanner and runner - the copy of the time-series rename route', () => {
  const fromReadings = contract(
    'from',
    { Event: event, Measurement: { collection: 'readings', fields: ['_id', 'at'] } },
    { events: new MongoCollection({}), readings: new MongoCollection({}) },
  );
  const renameCopy = dataTransform('copy readings to measurements', {
    run: () => rawAggregate('measurements', [{ $unionWith: 'readings' }, { $out: 'measurements' }]),
  });

  it(
    'keeps every document once when the apply stops between the copy and the drop, and the source is dropped as the failure says',
    async () => {
      await live
        .db()
        .collection('events')
        .insertMany([{ name: 'launch' }]);
      await live
        .db()
        .collection('readings')
        .insertMany([
          { at, value: 1 },
          { at, value: 2 },
        ]);
      await live.initMarker(fromReadings);
      const planned = await new MongoMigrationPlanner().plan({
        contract: to,
        schema: await introspectSchema(live.db()),
        policy,
        fromContract: fromReadings,
        origin: { storageHash: 'from' },
        statements: [],
        frameworkComponents: [],
        snapshotsImportPath: '../../snapshots',
      });
      if (planned.kind !== 'success') throw new Error(JSON.stringify(planned.conflicts));
      const operations = planned.plan.operations as readonly AnyMongoMigrationOperation[];
      const drop = operations.find((operation) => operation.label === 'Drop collection readings');
      if (drop === undefined) throw new Error(JSON.stringify(operations.map((o) => o.label)));
      const others = operations.filter((operation) => operation !== drop);
      const create = others.findIndex((operation) => operation.label.includes('measurements'));
      const before = others.slice(0, create + 1);
      const after = others.slice(create + 1);

      const first = await live.runOperations(
        [...before, renameCopy, failing, drop, ...after],
        fromReadings,
        to,
        { policy },
      );
      const advice = first.ok ? undefined : first.failure.why;
      await live.db().dropCollection('readings');
      const second = await live.runOperations(
        [...before, renameCopy, drop, ...after],
        fromReadings,
        to,
        { policy },
      );

      expect({
        advice,
        second: second.ok ? 'applied' : second.failure,
        readings: await live.db().listCollections({ name: 'readings' }).toArray(),
        ...(await state()),
      }).toEqual({
        advice: expect.stringContaining(
          `Operation data_transform.copy readings to measurements copied the documents of collection readings into collection measurements with an $out stage, and operation ${drop.id}, which drops collection readings, has not run. Writes to collections measurements and readings must still be stopped: deleting the documents of collection readings or dropping it also removes any document written to collection readings since the copy, which the copy did not take. If you cannot be sure that nothing wrote to either collection since the apply stopped, keep collection readings as it is and compare the two collections: a document of collection readings was copied when collection measurements holds the same document, whole and under the same _id. List those with db.getCollection("readings").aggregate([${LOOKUP}]) in mongosh. ${AFTER_LISTING('readings')} Otherwise, before you run the command again, delete the documents of collection readings or drop it yourself`,
        ),
        second: 'applied',
        readings: [],
        ...moved,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
