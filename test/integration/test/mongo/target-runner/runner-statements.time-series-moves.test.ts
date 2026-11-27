import { introspectSchema } from '@internal/adapter-mongo/control';
import type { MigrationOperationPolicy } from '@internal/framework-components/control';
import { type MongoCollationOptionsInput, MongoCollection } from '@internal/mongo-contract';
import type { AnyMongoMigrationOperation } from '@internal/mongo-query-ast/control';
import { MongoMigrationPlanner } from '@internal/target-mongo/control';
import { dataTransform, deleteDocuments, rawAggregate } from '@internal/target-mongo/migration';
import { timeouts } from '@repo/test-utils';
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
const UNCHANGED = 'nothing wrote to or deleted from either collection since the apply started';
/** What the next run does with the source: readings is copied whole and dropped, events only by the copy's filter. */
const RERUN_COPIES = (source: string) =>
  source === 'readings'
    ? 'The next run copies every document of collection readings into collection measurements again, then drops collection readings, so before you run it, leave in collection readings only the documents that collection measurements does not hold yet.'
    : `The next run copies every document of collection ${source} that the copy selects into collection measurements again, then deletes them from collection ${source}, so before you run it, leave in collection ${source} every document the copy does not select, and of those it selects only the ones that collection measurements does not hold yet.`;
const SETTLE_BY_HAND = (source: string) =>
  `delete nothing from either collection, and do not run the command again, until you have compared collections measurements and ${source} by hand and settled which documents each should keep: only you can tell which of their documents are which. ${RERUN_COPIES(source)}`;
const UNSURE = (source: string) =>
  `If you cannot be sure that ${UNCHANGED}, ${SETTLE_BY_HAND(source)} Otherwise`;
const WRITES_STOPPED =
  'Writes to collections measurements and events must still be stopped: that delete also removes any document written to collection events since the copy, which the copy did not take.';
const STOPPED = `${WRITES_STOPPED} ${UNSURE('events')}`;
const COPY_ENDED =
  'first check that it is no longer running: MongoDB keeps running an aggregate that ends in $out after the connection that sent it drops. In mongosh, connected to this database, db.getSiblingDB("admin").aggregate([{ $currentOp: { allUsers: true } }, { $match: { "command.$db": db.getName(), $expr: { $let: { vars: { last: { $arrayElemAt: [{ $objectToArray: { $last: "$command.pipeline" } }, 0] } }, in: { $and: [{ $in: ["$$last.k", [{ $literal: "$out" }, { $literal: "$merge" }]] }, { $in: ["measurements", ["$$last.v", "$$last.v.coll", "$$last.v.into", "$$last.v.into.coll"]] }] } } } } }]) lists the copy while it runs. Wait until it lists nothing, or end the copy with db.killOp(<the opid it lists>) and run the query again until it lists nothing: killOp only marks the copy to end, and it can run on for a moment.';
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
          `Operation data_transform.move Measurement documents to measurements copied documents into collection measurements with an $out stage, and operation ${deletion.id}, which deletes them from collection events, has not finished. ${STOPPED}, before you run the command again, finish that delete yourself, on collection events with the filter and collation of its deleteDocuments call in the migration's migration.ts`,
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
  async function interruptedCopy(mode: 'beforeCommit' | 'afterCommit') {
    const { before, after } = await routeAround();
    const overlapping = await live.db().collection('events').findOne({ value: 1 });
    if (overlapping === null) throw new Error('The events document with value 1 is missing');
    await live.db().createCollection('measurements', { timeseries: { timeField: 'at' } });
    await live.db().collection('measurements').insertOne({ _id: overlapping._id, at, value: 0 });
    const setUp = before.filter((operation) => !operation.label.includes('measurements'));
    const proxy = await outInterruptingClient(live.uri(), mode);
    try {
      const first = await live.runOperations([...setUp, copy, deletion, ...after], from, to, {
        policy,
        client: proxy.client,
      });
      return {
        advice: first.ok ? undefined : first.failure.why,
        count: await live.db().collection('measurements').countDocuments(),
        rerun: [...setUp, copy, deletion, ...after],
      };
    } finally {
      await proxy.close();
    }
  }

  const counts = `Before the copy, collection measurements held 1 document, and the copy was to add 2 documents of collection events. To tell whether it finished, ${COPY_ENDED} Then count the documents of collection measurements that a majority of the replica set has written, which a failover cannot roll back, for example with db.getCollection("measurements").countDocuments({}, { readConcern: { level: "majority" } }) in mongosh. The count shows this only if ${UNCHANGED}. If you cannot be sure of that, ${SETTLE_BY_HAND('events')} If it holds 3, and ${UNCHANGED}, the copy finished. ${WRITES_STOPPED} Before you run the command again, run that delete yourself`;

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
          `${counts}, on collection events with the filter and collation of its deleteDocuments call in the migration's migration.ts. The copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If it holds 1, and ${UNCHANGED}, the copy most likely did not finish, but a majority count can lag behind the copy's last writes: wait a moment and count again. If it still holds 1, delete nothing, and run the command again as it is. Even then the copy may have finished, and the run then adds the documents it selects in collection events to collection measurements a second time: the query below finds them.`,
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
    'keeps a document written to the source after the stop, when the user settles the collections by hand before the re-run',
    async () => {
      const { advice, count, rerun } = await interruptedCopy('afterCommit');
      await live.db().collection('events').insertOne({ at, value: 3 });
      const settled = await live
        .db()
        .collection('events')
        .deleteMany({ at, value: { $in: [1, 2] } });
      const second = await live.runOperations(rerun, from, to, { policy });

      expect({
        advice,
        count,
        settled: settled.deletedCount,
        second: second.ok ? 'applied' : second.failure,
        measurements: await live.documents('measurements'),
        events: await live.documents('events'),
      }).toEqual({
        advice: expect.stringContaining(
          `The count shows this only if ${UNCHANGED}. If you cannot be sure of that, ${SETTLE_BY_HAND('events')}`,
        ),
        count: 3,
        settled: 2,
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

describe('MongoMigrationPlanner and runner - a move into a time-series collection whose connection drops while the copy still runs', () => {
  const slowCopy = dataTransform('move Measurement documents to measurements', {
    run: () =>
      rawAggregate('measurements', [
        {
          $unionWith: {
            coll: 'events',
            pipeline: [
              { $match: filter },
              {
                $addFields: {
                  slow: {
                    $function: {
                      body: 'function() { sleep(400); return 1; }',
                      args: [],
                      lang: 'js',
                    },
                  },
                },
              },
              { $unset: 'slow' },
            ],
          },
        },
        { $out: 'measurements' },
      ]),
  });
  const slowStage = {
    $addFields: {
      slow: { $function: { body: 'function() { sleep(400); return 1; }', args: [], lang: 'js' } },
    },
  };
  /**
   * Holds every write on the server until `release`, so a copy that has started stays running,
   * waiting to write, while the test looks at it. Reads go on.
   */
  const holdWrites = async () => {
    await live.db().admin().command({ fsync: 1, lock: true });
  };
  const releaseWrites = async () => {
    await live.db().admin().command({ fsyncUnlock: 1 });
  };
  const currentOps = async (match: Record<string, unknown>): Promise<readonly unknown[]> => {
    const reply = await live
      .db()
      .admin()
      .command({
        aggregate: 1,
        pipeline: [{ $currentOp: { allUsers: true } }, { $match: match }],
        cursor: {},
      });
    return reply['cursor'].firstBatch;
  };
  /** A read of collection measurements that sleeps until the test ends it with `killOps`. */
  const endlessStage = {
    $addFields: {
      slow: {
        $function: { body: 'function() { sleep(60000); return 1; }', args: [], lang: 'js' },
      },
    },
  };
  const readOfMeasurements = {
    'command.aggregate': 'measurements',
    'command.pipeline.0.$unionWith.pipeline.0.$addFields': { $exists: true },
  };
  const killOps = async (ops: readonly unknown[]) => {
    for (const op of ops) {
      await live
        .db()
        .admin()
        .command({ killOp: 1, op: Reflect.get(Object(op), 'opid') });
    }
  };
  /** The copies into collection measurements that the server is running, as the advice's $currentOp lists them. */
  const runningCopies = () =>
    currentOps({
      'command.$db': live.db().databaseName,
      $expr: {
        $let: {
          vars: { last: { $arrayElemAt: [{ $objectToArray: { $last: '$command.pipeline' } }, 0] } },
          in: {
            $and: [
              { $in: ['$$last.k', [{ $literal: '$out' }, { $literal: '$merge' }]] },
              {
                $in: [
                  'measurements',
                  ['$$last.v', '$$last.v.coll', '$$last.v.into', '$$last.v.into.coll'],
                ],
              },
            ],
          },
        },
      },
    });

  it(
    'says to check that the copy is no longer running before counting, since MongoDB finishes the $out after the connection drops',
    async () => {
      const { before, after } = await routeAround();
      const proxy = await outInterruptingClient(live.uri(), 'whileRunning', holdWrites);
      let held: {
        readonly onMeasurements: readonly unknown[];
        readonly running: readonly unknown[];
        readonly countWhileRunning: number;
      };
      let first: Awaited<ReturnType<typeof live.runOperations>>;
      try {
        first = await live
          .runOperations([...before, slowCopy, deletion, ...after], from, to, {
            policy,
            client: proxy.client,
          })
          .finally(() => proxy.close());
        const read = live
          .db()
          .collection('measurements')
          .aggregate([
            { $unionWith: { coll: 'events', pipeline: [endlessStage] } },
            { $count: 'n' },
          ])
          .toArray()
          .catch((error: unknown) => error);
        let reads = await currentOps(readOfMeasurements);
        for (let attempt = 0; reads.length === 0 && attempt < 100; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          reads = await currentOps(readOfMeasurements);
        }
        held = {
          onMeasurements: await currentOps({ 'command.aggregate': 'measurements' }),
          running: await runningCopies(),
          countWhileRunning: await live.db().collection('measurements').countDocuments(),
        };
        await killOps(reads);
        await read;
      } finally {
        await releaseWrites();
      }
      const { onMeasurements, running, countWhileRunning } = held;
      while ((await runningCopies()).length > 0) {
        await new Promise((resolve) => setTimeout(resolve, 100));
      }
      const countOnceEnded = await live.db().collection('measurements').countDocuments();
      await live.db().collection('events').deleteMany(filter);
      const second = await live.runOperations([...before, slowCopy, deletion, ...after], from, to, {
        policy,
      });

      expect({
        advice: first.ok ? undefined : first.failure.why,
        onMeasurements: onMeasurements.length,
        running: running.length,
        countWhileRunning,
        countOnceEnded,
        second: second.ok ? 'applied' : second.failure,
        ...(await state()),
      }).toEqual({
        advice: expect.stringContaining(
          `Before the copy, collection measurements held 0 documents, and the copy was to add 2 documents of collection events. To tell whether it finished, ${COPY_ENDED} Then count`,
        ),
        onMeasurements: 2,
        running: 1,
        countWhileRunning: 0,
        countOnceEnded: 2,
        second: 'applied',
        ...moved,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );

  it(
    'lists a copy whose command is over 1 KB in full, which the currentOp command cuts down to a string without its database or pipeline',
    async () => {
      await live
        .db()
        .collection('events')
        .insertMany([
          { at, value: 1 },
          { at, value: 2 },
        ]);
      const pad = 'x'.repeat(2000);
      await holdWrites();
      let running: readonly unknown[];
      let inprog: readonly { opid?: unknown; command?: object }[];
      let copying: Promise<unknown>;
      try {
        copying = live
          .db()
          .collection('events')
          .aggregate([
            { $match: filter },
            slowStage,
            { $addFields: { pad } },
            { $unset: ['slow', 'pad'] },
            { $out: 'measurements' },
          ])
          .toArray();
        running = await runningCopies();
        for (let attempt = 0; running.length === 0 && attempt < 100; attempt += 1) {
          await new Promise((resolve) => setTimeout(resolve, 50));
          running = await runningCopies();
        }
        ({ inprog } = await live.db().admin().command({ currentOp: 1, $all: true }));
      } finally {
        await releaseWrites();
      }
      const [copy] = running;
      const cutDown = inprog.find(({ opid }) => opid === Reflect.get(Object(copy), 'opid'));
      await copying;

      expect({
        running: running.length,
        size: JSON.stringify(running).length > 2000,
        cutDown: Object.keys(cutDown?.command ?? {}),
        afterwards: await runningCopies(),
      }).toEqual({ running: 1, size: true, cutDown: ['$truncated'], afterwards: [] });
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
          `Operation ${groupsCopy.id} copied documents into collection measurements with an $out stage, and operations ${measurementDeletion.id} and ${sampleDeletion.id}, which delete them from collection events, have not finished. Writes to collections measurements and events must still be stopped: those deletes also remove any document written to collection events since the copy, which the copy did not take. ${UNSURE('events')}, before you run the command again, finish those deletes yourself`,
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
          `Operation data_transform.copy readings to measurements copied the documents of collection readings into collection measurements with an $out stage, and operation ${drop.id}, which drops collection readings, has not run. Writes to collections measurements and readings must still be stopped: deleting the documents of collection readings or dropping it also removes any document written to collection readings since the copy, which the copy did not take. ${UNSURE('readings')}, before you run the command again, delete the documents of collection readings or drop it yourself`,
        ),
        second: 'applied',
        readings: [],
        ...moved,
      });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});

describe('MongoMigrationRunner - a move into a time-series collection with another collation', () => {
  const caseInsensitive: MongoCollationOptionsInput = { locale: 'en', strength: 2 };
  const sample = { at, kind: 'sample', value: 1 };
  const capitalSample = { at, kind: 'Sample', value: 2 };
  const other = { at, kind: 'other', value: 3 };
  const fields = ['_id', 'at', 'kind', 'value'];
  const collations = (
    source: MongoCollationOptionsInput | undefined,
    target: MongoCollationOptionsInput | undefined,
  ) => ({
    from: contract(
      'from',
      { Measurement: { collection: 'events', fields } },
      {
        events: new MongoCollection(source === undefined ? {} : { options: { collation: source } }),
      },
    ),
    to: contract(
      'to',
      { Reading: { collection: 'measurements', fields } },
      {
        events: new MongoCollection(source === undefined ? {} : { options: { collation: source } }),
        measurements: new MongoCollection({
          options: {
            timeseries: { timeField: 'at' },
            ...(target === undefined ? {} : { collation: target }),
          },
        }),
      },
    ),
  });
  const moveBy = (
    moveFilter: Record<string, unknown>,
    target: MongoCollationOptionsInput | undefined,
  ) => [
    dataTransform('move Measurement documents to measurements', {
      run: () =>
        rawAggregate('measurements', [
          { $unionWith: { coll: 'events', pipeline: [{ $match: moveFilter }] } },
          { $out: 'measurements' },
        ]),
    }),
    deleteDocuments({
      collection: 'events',
      filter: moveFilter,
      collation: target ?? { locale: 'simple' },
    }),
  ];
  const setUp = async (
    source: MongoCollationOptionsInput | undefined,
    target: MongoCollationOptionsInput | undefined,
  ) => {
    const db = live.db();
    await db.createCollection('events', source === undefined ? {} : { collation: source });
    await db.createCollection('measurements', {
      timeseries: { timeField: 'at' },
      ...(target === undefined ? {} : { collation: target }),
    });
    await db.collection('events').insertMany([{ ...sample }, { ...capitalSample }, { ...other }]);
    const contracts = collations(source, target);
    await live.initMarker(contracts.from);
    return contracts;
  };
  const projected = async (name: string) =>
    live
      .db()
      .collection(name)
      .find({}, { projection: { _id: 0 }, sort: { value: 1 } })
      .toArray();

  const pairs = [
    {
      pair: 'a case-insensitive source and a case-sensitive target',
      source: caseInsensitive,
      target: undefined,
      moved: [sample],
      kept: [capitalSample, other],
    },
    {
      pair: 'a case-sensitive source and a case-insensitive target',
      source: undefined,
      target: caseInsensitive,
      moved: [sample, capitalSample],
      kept: [other],
    },
  ];
  const filters = [
    { by: 'a string', moveFilter: { kind: 'sample' } },
    { by: '$in', moveFilter: { kind: { $in: ['sample'] } } },
  ];

  it.each(pairs.flatMap((pair) => filters.map((filter) => ({ ...pair, ...filter }))))(
    "moves every document the copy selects exactly once, with a filter by $by and a delete that has the target's collation, for $pair",
    async ({ source, target, moved, kept, moveFilter }) => {
      const { from: fromContract, to: toContract } = await setUp(source, target);

      const result = await live.runOperations(
        moveBy(moveFilter, target),
        fromContract,
        toContract,
        {
          policy,
        },
      );

      expect({
        result: result.ok ? 'applied' : result.failure,
        events: await projected('events'),
        measurements: await projected('measurements'),
      }).toEqual({ result: 'applied', events: kept, measurements: moved });
    },
    timeouts.spinUpMongoMemoryServer,
  );
});
