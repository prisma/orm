import { ListCollectionsCommand } from '@internal/mongo-query-ast/control';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { InternalError } from '@internal/utils/internal-error';
import { MongoServerError, MongoWriteConcernError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  dataTransform,
  deleteDocuments,
  dropCollection,
  rawAggregate,
} from '../src/core/migrations/migration-factories';
import {
  execute,
  failureFields,
  makeHarness,
  makeRunPlan,
  NOOP_MARKER_OPS,
  type Row,
} from './mongo-runner-harness';

const FILTER = { at: { $exists: true } };
const unionCopy = dataTransform('move Measurement to measurements', {
  run: () =>
    rawAggregate('measurements', [
      { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }] } },
      { $out: 'measurements' },
    ]),
});
const renameCopy = dataTransform('copy readings to measurements', {
  run: () => rawAggregate('measurements', [{ $unionWith: 'readings' }, { $out: 'measurements' }]),
});
const loneCopy = dataTransform('move Measurement to measurements', {
  run: () => rawAggregate('events', [{ $match: FILTER }, { $out: 'measurements' }]),
});
const deletion = deleteDocuments({ collection: 'events', filter: FILTER });
const failingUpdate = dataTransform('fill status', { run: () => makeRunPlan() });
const checkedTransform = dataTransform('fill name', {
  check: { source: () => rawAggregate('events', [{ $match: { name: null } }, { $limit: 1 }]) },
  run: () => makeRunPlan(),
});
const badValue = new MongoServerError({
  ok: 0,
  code: 2,
  codeName: 'BadValue',
  errmsg: 'bad value',
});
const COPY_COUNTS: Row[][] = [[], []];
const LOST = new Error('connection 3 to 127.0.0.1:27017 closed');
const copyAndDelete = [...COPY_COUNTS, [], [{ _id: 1 }], [], []];
const stopsAtCheckedTransform = [...copyAndDelete, [{ _id: 1 }], []];

const DUPLICATES = `To find them, group collection measurements by _id and keep each _id that appears more than once, for example with db.getCollection("measurements").aggregate([{ $group: { _id: '$_id', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]) in mongosh.`;

/** What the next run does with the source: readings is copied whole and dropped, events only by the copy's filter. */
const RERUN_COPIES = (source: string) =>
  source === 'readings'
    ? 'The next run copies every document of collection readings into collection measurements again, then drops collection readings, so before you run it, leave in collection readings only the documents that collection measurements does not hold yet.'
    : `The next run copies every document of collection ${source} that the copy selects into collection measurements again, then deletes them from collection ${source}, so before you run it, leave in collection ${source} only the documents that collection measurements does not hold yet.`;
const SETTLE_BY_HAND = (source: string) =>
  `delete nothing from either collection, and do not run the command again, until you have compared collections measurements and ${source} by hand and settled which documents each should keep: only you can tell which of their documents are which. ${RERUN_COPIES(source)}`;
const UNSURE = (source: string) =>
  `If you cannot be sure that nothing wrote to or deleted from either collection since the apply stopped, ${SETTLE_BY_HAND(source)} Otherwise`;
const WRITES_STOPPED_EVENTS =
  'Writes to collections measurements and events must still be stopped: that delete also removes any document written to collection events since the copy, which the copy did not take.';
const WRITES_STOPPED_READINGS =
  'Writes to collections measurements and readings must still be stopped: deleting the documents of collection readings or dropping it also removes any document written to collection readings since the copy, which the copy did not take.';
const STOPPED_EVENTS = `${WRITES_STOPPED_EVENTS} ${UNSURE('events')}`;
const STOPPED_READINGS = `${WRITES_STOPPED_READINGS} ${UNSURE('readings')}`;
const UNCHANGED = 'nothing wrote to or deleted from either collection since the apply stopped';
const COPY_ENDED =
  'first check that it is no longer running: MongoDB keeps running an aggregate that ends in $out after the connection that sent it drops. In mongosh, connected to this database, db.getSiblingDB("admin").aggregate([{ $currentOp: { allUsers: true } }, { $match: { "command.$db": db.getName(), $expr: { $let: { vars: { last: { $arrayElemAt: [{ $objectToArray: { $last: "$command.pipeline" } }, 0] } }, in: { $and: [{ $in: ["$$last.k", [{ $literal: "$out" }, { $literal: "$merge" }]] }, { $in: ["measurements", ["$$last.v", "$$last.v.coll", "$$last.v.into", "$$last.v.into.coll"]] }] } } } } }]) lists the copy while it runs. Wait until it lists nothing, or end the copy with db.killOp(<the opid it lists>) and run the query again until it lists nothing: killOp only marks the copy to end, and it can run on for a moment.';

const unfinished = `Operation data_transform.move Measurement to measurements copied documents into collection measurements with an $out stage, and operation ${deletion.id}, which deletes them from collection events, has not finished. ${STOPPED_EVENTS}, before you run the command again, finish that delete yourself, on collection events with the filter of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If the command was already run again before the delete finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES}`;

describe('MongoMigrationRunner, a stop after a copy that ends in $out', () => {
  it('says to finish the delete on the source when the apply stops between the copy and the delete', async () => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(badValue);

    const result = await execute(harness, [unionCopy, failingUpdate, deletion]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. ${unfinished} The operations that ran before the failure stay applied.`,
    );
  });

  it('says the same when the delete itself fails', async () => {
    const harness = makeHarness();
    for (const rows of [...COPY_COUNTS, [], [{ _id: 1 }]]) harness.driver.queueResponse(rows);
    harness.driver.failUpdateManyWith(badValue);

    const result = await execute(harness, [unionCopy, deletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message: `Operation ${deletion.id} failed: MongoDB error 2 (BadValue): bad value`,
      why: `Documents the delete removed before the error stay removed. Fix what MongoDB names, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. ${unfinished} The operations that ran before the failure stay applied.`,
    });
  });

  it('gives the same advice when the delete throws, as a lost connection does', async () => {
    const harness = makeHarness();
    for (const rows of [...COPY_COUNTS, [], [{ _id: 1 }]]) harness.driver.queueResponse(rows);
    harness.driver.failUpdateManyWith(new Error('connection 3 to 127.0.0.1:27017 closed'));

    const result = await execute(harness, [unionCopy, deletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message: `Operation ${deletion.id} failed: connection 3 to 127.0.0.1:27017 closed`,
      why: `Fix what the error names, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. ${unfinished} The operations that ran before the failure stay applied.`,
    });
  });

  it('adds the advice to a structured error that an operation after the copy throws', async () => {
    const writingCheck = dataTransform('fill name', {
      check: { source: () => rawAggregate('events', [{ $out: 'elsewhere' }]) },
      run: () => makeRunPlan(),
    });
    const harness = makeHarness();

    await expect(execute(harness, [unionCopy, writingCheck, deletion])).rejects.toMatchObject({
      code: 'MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY',
      why: `A migration check must only read, so that running it cannot change the database; the $out stage of its pipeline writes its results to a collection. ${unfinished}`,
    });
  });

  it('says nothing about the copy once the delete has finished', async () => {
    const harness = makeHarness();
    for (const rows of stopsAtCheckedTransform) harness.driver.queueResponse(rows);

    const result = await execute(harness, [unionCopy, deletion, checkedTransform]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      why: 'The operations that ran before the failure stay applied.',
    });
  });

  it('says nothing about the copy when the apply fails after its last operation', async () => {
    const harness = makeHarness({
      markerOps: {
        ...NOOP_MARKER_OPS,
        readMarker: async () => ({
          storageHash: 'origin',
          profileHash: 'origin',
          contractJson: null,
          canonicalVersion: null,
          updatedAt: new Date(0),
          appTag: null,
          meta: {},
          invariants: [],
        }),
        updateMarker: async () => false,
      },
    });
    for (const rows of copyAndDelete) harness.driver.queueResponse(rows);

    const result = await execute(harness, [unionCopy, deletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.MARKER_CAS_FAILURE',
      why: 'Another process changed the marker and changed it back while this run was writing it. Run the command again. The operations that ran before the failure stay applied.',
    });
  });

  it('pairs each of two copies from one source with the delete that has its filter', async () => {
    const other = { name: { $exists: true } };
    const readingsCopy = dataTransform('move Reading to readings', {
      run: () =>
        rawAggregate('readings', [
          { $unionWith: { coll: 'events', pipeline: [{ $match: other }] } },
          { $out: 'readings' },
        ]),
    });
    const otherDeletion = deleteDocuments({ collection: 'events', filter: other });
    const harness = makeHarness();
    for (const rows of [...COPY_COUNTS, [], ...COPY_COUNTS, [], [{ _id: 1 }], [], []]) {
      harness.driver.queueResponse(rows);
    }
    harness.driver.failUpdateManyWith(badValue);

    const result = await execute(harness, [unionCopy, readingsCopy, deletion, otherDeletion]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `Documents the delete removed before the error stay removed. Fix what MongoDB names, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. ${unfinished} Operation data_transform.move Reading to readings copied documents into collection readings with an $out stage, and operation ${otherDeletion.id}, which deletes them from collection events, has not finished.`,
    );
  });

  it('names each unfinished delete of a copy with one $unionWith stage for each group of models', async () => {
    const sample = { kind: 'sample' };
    const groupsCopy = dataTransform('move Measurement and Sample to measurements', {
      run: () =>
        rawAggregate('measurements', [
          { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }, { $unset: ['x'] }] } },
          { $unionWith: { coll: 'events', pipeline: [{ $match: sample }] } },
          { $out: 'measurements' },
        ]),
    });
    const sampleDeletion = deleteDocuments({ collection: 'events', filter: sample });
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(badValue);

    const result = await execute(harness, [groupsCopy, failingUpdate, deletion, sampleDeletion]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `Operation data_transform.move Measurement and Sample to measurements copied documents into collection measurements with an $out stage, and operations ${deletion.id} and ${sampleDeletion.id}, which delete them from collection events, have not finished. Writes to collections measurements and events must still be stopped: those deletes also remove any document written to collection events since the copy, which the copy did not take. ${UNSURE('events')}, before you run the command again, finish those deletes yourself, on collection events, each with the filter of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If the command was already run again before the deletes finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES}`,
    );
  });

  it('names only the delete that has not finished once the delete of the other group has', async () => {
    const sample = { kind: 'sample' };
    const groupsCopy = dataTransform('move Measurement and Sample to measurements', {
      run: () =>
        rawAggregate('measurements', [
          { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }] } },
          { $unionWith: { coll: 'events', pipeline: [{ $match: sample }] } },
          { $out: 'measurements' },
        ]),
    });
    const sampleDeletion = deleteDocuments({ collection: 'events', filter: sample });
    const harness = makeHarness();
    for (const rows of [[], ...stopsAtCheckedTransform]) harness.driver.queueResponse(rows);

    const result = await execute(harness, [groupsCopy, deletion, checkedTransform, sampleDeletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      why: expect.stringContaining(
        `with an $out stage, and operation ${sampleDeletion.id}, which deletes them from collection events, has not finished.`,
      ),
    });
  });

  it('pairs a copy whose stages rename the field its filter reads with the delete that has its filter, and leaves an unsure user to settle the collections by hand', async () => {
    const renamingCopy = dataTransform('move Measurement to measurements', {
      run: () =>
        rawAggregate('measurements', [
          {
            $unionWith: {
              coll: 'events',
              pipeline: [{ $match: FILTER }, { $set: { when: '$at' } }, { $unset: ['at'] }],
            },
          },
          { $out: 'measurements' },
        ]),
    });
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(badValue);

    const result = await execute(harness, [renamingCopy, failingUpdate, deletion]);

    const { why } = failureFields(result.assertNotOk());
    expect(why).toContain(
      `operation ${deletion.id}, which deletes them from collection events, has not finished.`,
    );
    expect(why).toContain(STOPPED_EVENTS);
  });

  it('throws an InternalError again as it is, with no advice', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([]);
    const bug = new InternalError('an invariant broke');
    harness.driver.failUpdateManyWith(bug);

    await expect(execute(harness, [unionCopy, failingUpdate, deletion])).rejects.toBe(bug);
  });

  it.each([
    {
      shape: 'a copy that only a delete before it follows',
      operations: [deletion, unionCopy, failingUpdate],
    },
    {
      shape: 'a copy whose delete has another filter',
      operations: [
        unionCopy,
        failingUpdate,
        deleteDocuments({ collection: 'events', filter: { stale: true } }),
      ],
    },
    {
      shape: 'a summary $out followed by an unrelated delete',
      operations: [
        dataTransform('summarize events', {
          run: () => rawAggregate('events', [{ $group: { _id: '$name' } }, { $out: 'summary' }]),
        }),
        deleteDocuments({ collection: 'events', filter: { stale: true } }),
        failingUpdate,
      ],
    },
    {
      shape: 'an $out that rewrites its own collection',
      operations: [
        dataTransform('reshape measurements', {
          run: () =>
            rawAggregate('measurements', [{ $set: { unit: 'C' } }, { $out: 'measurements' }]),
        }),
        failingUpdate,
      ],
    },
    {
      shape: 'a copy that reads only its source',
      operations: [loneCopy, failingUpdate, deletion],
    },
    {
      shape: 'a copy of the whole source followed by the drop of another collection',
      operations: [renameCopy, failingUpdate, dropCollection('archive')],
    },
    {
      shape:
        'a copy whose $unionWith pipeline does not start with $match, followed by the drop of its source',
      operations: [
        dataTransform('reshape readings into measurements', {
          run: () =>
            rawAggregate('measurements', [
              { $unionWith: { coll: 'readings', pipeline: [{ $set: { unit: 'C' } }] } },
              { $out: 'measurements' },
            ]),
        }),
        failingUpdate,
        dropCollection('readings'),
      ],
    },
    {
      shape: 'a copy whose $out writes into another database',
      operations: [
        dataTransform('move Measurement to archive', {
          run: () =>
            rawAggregate('measurements', [
              { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }] } },
              { $out: { db: 'archive', coll: 'measurements' } },
            ]),
        }),
        failingUpdate,
        deletion,
      ],
    },
    {
      shape: 'a copy of two groups whose second group has no delete',
      operations: [
        dataTransform('move Measurement and Sample to measurements', {
          run: () =>
            rawAggregate('measurements', [
              { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }] } },
              { $unionWith: { coll: 'events', pipeline: [{ $match: { kind: 'sample' } }] } },
              { $out: 'measurements' },
            ]),
        }),
        failingUpdate,
        deletion,
      ],
    },
  ])('says nothing about a copy the planner does not print: $shape', async ({ operations }) => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(badValue);

    const result = await execute(harness, operations);

    expect(failureFields(result.assertNotOk()).why).not.toContain('$out');
  });

  it('says to delete the documents of the source or drop it when the apply stops between a copy of the whole source and its drop', async () => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(badValue);
    const drop = dropCollection('readings');

    const result = await execute(harness, [renameCopy, failingUpdate, drop]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `Operation data_transform.copy readings to measurements copied the documents of collection readings into collection measurements with an $out stage, and operation ${drop.id}, which drops collection readings, has not run. ${STOPPED_READINGS}, before you run the command again, delete the documents of collection readings or drop it yourself: the copy has no check, so it runs again, and it would add the documents of collection readings to collection measurements a second time. Do not delete documents from collection measurements instead. If the command was already run again before collection readings was dropped, its documents are in collection measurements more than once: each of them is there two or more times, under the same _id. ${DUPLICATES} The operations that ran before the failure stay applied.`,
    );
  });

  it('says nothing about a copy of the whole source once its drop has run', async () => {
    const harness = makeHarness();
    for (const rows of [...COPY_COUNTS, [], [{ _id: 1 }], []]) harness.driver.queueResponse(rows);

    const result = await execute(harness, [
      renameCopy,
      dropCollection('readings'),
      checkedTransform,
    ]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      why: 'The operations that ran before the failure stay applied.',
    });
  });

  it('says how to tell from the counts whether a copy that threw while it ran finished, when its delete has not run', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ documents: 3 }]);
    harness.driver.queueResponse([{ documents: 2 }]);
    harness.driver.failAggregateWith(LOST, COPY_COUNTS.length);

    const result = await execute(harness, [unionCopy, deletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message: `Operation ${unionCopy.id} failed: connection 3 to 127.0.0.1:27017 closed`,
      why: `Fix what the error names, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. Operation ${unionCopy.id} was copying documents of collection events into collection measurements with an $out stage when the apply stopped. The error does not show whether the copy finished. Operation ${deletion.id}, which deletes them from collection events, has not run. Before the copy, collection measurements held 3 documents, and the copy was to add 2 documents of collection events. To tell whether it finished, ${COPY_ENDED} Then count the documents of collection measurements, for example with db.getCollection("measurements").countDocuments() in mongosh. The count shows this only if ${UNCHANGED}. If you cannot be sure of that, ${SETTLE_BY_HAND('events')} If it holds 5, and ${UNCHANGED}, the copy finished. ${WRITES_STOPPED_EVENTS} Before you run the command again, run that delete yourself, on collection events with the filter of its deleteDocuments call in the migration's migration.ts. The copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If it holds 3, and ${UNCHANGED}, the copy did not finish: delete nothing, and run the command again as it is. If it holds any other number, something else wrote to or deleted from collection measurements, or the command was already run again: ${SETTLE_BY_HAND('events')} If the command was already run again after the copy finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES} The operations that ran before the failure stay applied.`,
      meta: { operationId: unionCopy.id, databaseUnchanged: false },
    });
  });

  it('counts the documents each filter of the copy selects', async () => {
    const sample = { kind: 'sample' };
    const groupsCopy = dataTransform('move Measurement and Sample to measurements', {
      run: () =>
        rawAggregate('measurements', [
          { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }] } },
          { $unionWith: { coll: 'events', pipeline: [{ $match: sample }] } },
          { $out: 'measurements' },
        ]),
    });
    const sampleDeletion = deleteDocuments({ collection: 'events', filter: sample });
    const harness = makeHarness();
    for (const documents of [1, 2, 4]) harness.driver.queueResponse([{ documents }]);
    harness.driver.failAggregateWith(LOST, 3);

    const result = await execute(harness, [groupsCopy, deletion, sampleDeletion]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `Operations ${deletion.id} and ${sampleDeletion.id}, which delete them from collection events, have not run. Before the copy, collection measurements held 1 document, and the copy was to add 6 documents of collection events.`,
    );
    expect(harness.adapter.loweredPlans.slice(0, 3).map(({ command }) => command)).toEqual([
      expect.objectContaining({ collection: 'measurements', pipeline: [{ $count: 'documents' }] }),
      expect.objectContaining({
        collection: 'events',
        pipeline: [{ $match: FILTER }, { $count: 'documents' }],
      }),
      expect.objectContaining({
        collection: 'events',
        pipeline: [{ $match: sample }, { $count: 'documents' }],
      }),
    ]);
  });

  it('says how to tell whether a copy of the whole source that threw while it ran finished, when its drop has not run', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([]);
    harness.driver.queueResponse([{ documents: 4 }]);
    harness.driver.failAggregateWith(LOST, COPY_COUNTS.length);
    const drop = dropCollection('readings');

    const result = await execute(harness, [renameCopy, drop]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `Operation ${renameCopy.id} was copying the documents of collection readings into collection measurements with an $out stage when the apply stopped. The error does not show whether the copy finished. Operation ${drop.id}, which drops collection readings, has not run. Before the copy, collection measurements held 0 documents, and the copy was to add 4 documents of collection readings. To tell whether it finished, ${COPY_ENDED} Then count the documents of collection measurements, for example with db.getCollection("measurements").countDocuments() in mongosh. The count shows this only if ${UNCHANGED}. If you cannot be sure of that, ${SETTLE_BY_HAND('readings')} If it holds 4, and ${UNCHANGED}, the copy finished. ${WRITES_STOPPED_READINGS} Before you run the command again, delete the documents of collection readings or drop it yourself. The copy has no check, so it runs again, and it would add the documents of collection readings to collection measurements a second time.`,
    );
  });

  it('says to check that the copy has ended and that nothing wrote to either collection before running again, when the copy that threw had no document to copy', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ documents: 3 }]);
    harness.driver.failAggregateWith(LOST, COPY_COUNTS.length);

    const result = await execute(harness, [unionCopy, deletion]);

    expect(failureFields(result.assertNotOk()).why).toBe(
      `Fix what the error names, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. Operation ${unionCopy.id} was copying documents of collection events into collection measurements with an $out stage when the apply stopped. Collection events held no document for it to copy when it started. Before you run the command again, ${COPY_ENDED} Then, if ${UNCHANGED}, run the command again as it is. If you cannot be sure of that, ${SETTLE_BY_HAND('events')} The operations that ran before the failure stay applied.`,
    );
  });

  it('gives no copy advice when reading the counts before the copy fails, since the copy has not started', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(LOST);

    await expect(execute(harness, [unionCopy, deletion])).rejects.toBe(LOST);
  });

  it('records a copy whose count read failed as not started, so the stop is after the operation before it', async () => {
    const harness = makeHarness();
    for (const rows of [...COPY_COUNTS, []]) harness.driver.queueResponse(rows);
    harness.driver.failAggregateWith(LOST, COPY_COUNTS.length + 1);
    const drop = dropCollection('readings');

    const result = await execute(harness, [renameCopy, unionCopy, drop, deletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message: `The apply stopped after operation ${renameCopy.id} finished: connection 3 to 127.0.0.1:27017 closed`,
      why: expect.stringContaining(
        `Operation ${renameCopy.id} copied the documents of collection readings into collection measurements with an $out stage, and operation ${drop.id}, which drops collection readings, has not run.`,
      ),
      meta: { operationId: renameCopy.id, databaseUnchanged: false },
    });
    expect(failureFields(result.assertNotOk()).why).not.toContain(unionCopy.id);
  });

  it('treats a write-concern error on the copy as a copy that may have finished', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ documents: 3 }]);
    harness.driver.queueResponse([{ documents: 2 }]);
    harness.driver.failAggregateWith(
      new MongoWriteConcernError({
        ok: 1,
        writeConcernError: {
          code: 64,
          codeName: 'WriteConcernFailed',
          errmsg: 'waiting for replication timed out',
        },
      }),
      COPY_COUNTS.length,
    );

    const result = await execute(harness, [unionCopy, deletion]);

    const { why, meta } = failureFields(result.assertNotOk());
    expect(why).toContain(
      'If it holds 5, and nothing wrote to or deleted from either collection since the apply stopped, the copy finished',
    );
    expect(why).not.toContain('is as it was');
    expect(meta).toMatchObject({ databaseUnchanged: false });
  });

  it('says a drop of the source that threw may not have finished', async () => {
    const harness = makeHarness({ ddlError: LOST });
    harness.inspectionExecutor.collections = [{ name: 'readings' }];
    const drop = dropCollection('readings');

    const result = await execute(harness, [renameCopy, drop]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `Operation ${renameCopy.id} copied the documents of collection readings into collection measurements with an $out stage, and operation ${drop.id}, which drops collection readings, was running when the apply stopped and may not have finished. If collection readings is gone, run the command again. ${STOPPED_READINGS}, before you run the command again, delete the documents of collection readings or drop it yourself:`,
    );
  });

  it.each([
    { drop: 'runs', operation: dropCollection('readings') },
    {
      drop: 'is skipped, since its after-check finds collection readings gone',
      operation: {
        ...dropCollection('readings'),
        postcheck: [
          {
            description: 'collection readings does not exist',
            source: new ListCollectionsCommand(),
            filter: MongoFieldFilter.eq('name', 'readings'),
            expect: 'notExists' as const,
          },
        ],
      },
    },
  ])(
    'throws the error of a callback after the drop of the source as it is, when the drop $drop',
    async ({ operation }) => {
      const harness = makeHarness();
      const broke = new Error('the progress display broke');

      await expect(
        execute(harness, [renameCopy, operation], undefined, {
          onOperationComplete: (completed) => {
            if (completed.id === operation.id) throw broke;
          },
        }),
      ).rejects.toBe(broke);
    },
  );

  it('keeps the advice for a copy that finished when the callback after it throws', async () => {
    const harness = makeHarness();
    const broke = new Error('the progress display broke');

    const result = await execute(harness, [unionCopy, deletion], undefined, {
      onOperationComplete: (operation) => {
        if (operation.id === unionCopy.id) throw broke;
      },
    });

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message: `The apply stopped after operation ${unionCopy.id} finished: the progress display broke`,
      why: `Fix what the error names, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. ${unfinished} The operations that ran before the failure stay applied.`,
    });
  });

  it('calls a failed $out copy a copy, which wrote nothing', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(badValue, COPY_COUNTS.length);

    const result = await execute(harness, [unionCopy, deletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      message:
        'Operation data_transform.move Measurement to measurements failed: MongoDB error 2 (BadValue): bad value',
      why: "Collection measurements is as it was: an $out stage replaces it only when the whole pipeline succeeds. Fix what MongoDB names; when it comes from the copy, change its pipeline in the migration's migration.ts and run the file with node. Then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. The operations that ran before the failure stay applied.",
    });
  });
});
