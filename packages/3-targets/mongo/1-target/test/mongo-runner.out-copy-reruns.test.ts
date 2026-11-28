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
  type Harness,
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
    : `The next run copies every document of collection ${source} that the copy selects into collection measurements again, then deletes them from collection ${source}, so before you run it, leave in collection ${source} every document the copy does not select, and of those it selects only the ones that collection measurements does not hold yet.`;
const SETTLE_BY_HAND = (source: string) =>
  `delete nothing from either collection, and do not run the command again, until you have compared collections measurements and ${source} by hand and settled which documents each should keep: only you can tell which of their documents are which. ${RERUN_COPIES(source)}`;
const UNSURE = (source: string) =>
  `If you cannot be sure that nothing wrote to or deleted from either collection since the apply started, ${SETTLE_BY_HAND(source)} Otherwise`;
const WRITES_STOPPED_EVENTS =
  'Writes to collections measurements and events must still be stopped: that delete also removes any document written to collection events since the copy, which the copy did not take.';
const WRITES_STOPPED_READINGS =
  'Writes to collections measurements and readings must still be stopped: deleting the documents of collection readings or dropping it also removes any document written to collection readings since the copy, which the copy did not take.';
const STOPPED_EVENTS = `${WRITES_STOPPED_EVENTS} ${UNSURE('events')}`;
const STOPPED_READINGS = `${WRITES_STOPPED_READINGS} ${UNSURE('readings')}`;
const UNCHANGED = 'nothing wrote to or deleted from either collection since the apply started';
const COPY_ENDED =
  'first check that it is no longer running: MongoDB keeps running an aggregate that ends in $out after the connection that sent it drops. In mongosh, connected to this database, db.getSiblingDB("admin").aggregate([{ $currentOp: { allUsers: true } }, { $match: { "command.$db": db.getName(), $expr: { $let: { vars: { last: { $arrayElemAt: [{ $objectToArray: { $last: "$command.pipeline" } }, 0] } }, in: { $and: [{ $in: ["$$last.k", [{ $literal: "$out" }, { $literal: "$merge" }]] }, { $in: ["measurements", ["$$last.v", "$$last.v.coll", "$$last.v.into", "$$last.v.into.coll"]] }] } } } } }]) lists the copy while it runs. Wait until it lists nothing, or end the copy with db.killOp(<the opid it lists>) and run the query again until it lists nothing: killOp only marks the copy to end, and it can run on for a moment.';

const CHECKED_RERUN =
  "unless the operation's check shows it already ran, the run copies the documents again";
const UNRECOGNISED = (id: string, into: string, stage: string, rerun: string) =>
  `Operation ${id} writes into collection ${into} with an aggregate that ends in ${stage}, and the error does not show whether it finished: it may have. Before you do anything else, first check that it is no longer running: MongoDB keeps running an aggregate that ends in ${stage} after the connection that sent it drops. In mongosh, connected to this database, db.getSiblingDB("admin").aggregate([{ $currentOp: { allUsers: true } }, { $match: { "command.$db": db.getName(), $expr: { $let: { vars: { last: { $arrayElemAt: [{ $objectToArray: { $last: "$command.pipeline" } }, 0] } }, in: { $and: [{ $in: ["$$last.k", [{ $literal: "$out" }, { $literal: "$merge" }]] }, { $in: [${JSON.stringify(into)}, ["$$last.v", "$$last.v.coll", "$$last.v.into", "$$last.v.into.coll"]] }] } } } } }]) lists the copy while it runs. Wait until it lists nothing, or end the copy with db.killOp(<the opid it lists>) and run the query again until it lists nothing: killOp only marks the copy to end, and it can run on for a moment. Then compare collection ${into} with the collections the operation reads by hand, and settle which documents each should keep. Do not run the command again until you have: ${rerun}, and could write them into collection ${into} a second time. The operations that ran before the failure stay applied.`;

const MAJORITY_COUNT =
  'Then count the documents of collection measurements that a majority of the replica set has written, which a failover cannot roll back, for example with db.getCollection("measurements").countDocuments({}, { readConcern: { level: "majority" } }) in mongosh.';

const unfinished = `Operation data_transform.move Measurement to measurements copied documents into collection measurements with an $out stage, and operation ${deletion.id}, which deletes them from collection events, has not finished. ${STOPPED_EVENTS}, before you run the command again, finish that delete yourself, on collection events with the filter and collation of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If the command was already run again before the delete finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES}`;

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
      `Operation data_transform.move Measurement and Sample to measurements copied documents into collection measurements with an $out stage, and operations ${deletion.id} and ${sampleDeletion.id}, which delete them from collection events, have not finished. Writes to collections measurements and events must still be stopped: those deletes also remove any document written to collection events since the copy, which the copy did not take. ${UNSURE('events')}, before you run the command again, finish those deletes yourself, on collection events, each with the filter and collation of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If the command was already run again before the deletes finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES}`,
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
    {
      shape: 'a copy whose $unionWith pipeline can drop documents its $match selects',
      operations: [
        dataTransform('move one Measurement to measurements', {
          run: () =>
            rawAggregate('measurements', [
              { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }, { $limit: 1 }] } },
              { $out: 'measurements' },
            ]),
        }),
        failingUpdate,
        deletion,
      ],
    },
    {
      shape: 'a copy with an after-check, which a run skips when it holds',
      operations: [
        dataTransform('move Measurement to measurements', {
          check: {
            source: () => rawAggregate('events', [{ $match: FILTER }, { $limit: 1 }]),
          },
          run: () =>
            rawAggregate('measurements', [
              { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }] } },
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
      why: `Fix what the error names, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. Operation ${unionCopy.id} was copying documents of collection events into collection measurements with an $out stage when the apply stopped. The error does not show whether the copy finished. Operation ${deletion.id}, which deletes them from collection events, has not run. Before the copy, collection measurements held 3 documents, and the copy was to add 2 documents of collection events. To tell whether it finished, ${COPY_ENDED} ${MAJORITY_COUNT} The count shows this only if ${UNCHANGED}. If you cannot be sure of that, ${SETTLE_BY_HAND('events')} If it holds 5, and ${UNCHANGED}, the copy finished. ${WRITES_STOPPED_EVENTS} Before you run the command again, run that delete yourself, on collection events with the filter and collation of its deleteDocuments call in the migration's migration.ts. The copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If it holds 3, and ${UNCHANGED}, the copy most likely did not finish, but a majority count can lag behind the copy's last writes: wait a moment and count again. If it still holds 3, delete nothing, and run the command again as it is. Even then the copy may have finished, and the run then adds the documents it selects in collection events to collection measurements a second time: the query below finds them. If it holds any other number, something else wrote to or deleted from collection measurements, or the command was already run again: ${SETTLE_BY_HAND('events')} If the command was already run again after the copy finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES} The operations that ran before the failure stay applied.`,
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
      `Operation ${renameCopy.id} was copying the documents of collection readings into collection measurements with an $out stage when the apply stopped. The error does not show whether the copy finished. Operation ${drop.id}, which drops collection readings, has not run. Before the copy, collection measurements held 0 documents, and the copy was to add 4 documents of collection readings. To tell whether it finished, ${COPY_ENDED} ${MAJORITY_COUNT} The count shows this only if ${UNCHANGED}. If you cannot be sure of that, ${SETTLE_BY_HAND('readings')} If it holds 4, and ${UNCHANGED}, the copy finished. ${WRITES_STOPPED_READINGS} Before you run the command again, delete the documents of collection readings or drop it yourself. The copy has no check, so it runs again, and it would add the documents of collection readings to collection measurements a second time.`,
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

  it('runs the copy when reading the counts before it fails, since the counts are only advice', async () => {
    const harness = makeHarness();
    harness.driver.failNextAggregateWith(LOST);

    const result = await execute(harness, [unionCopy, deletion]);

    expect({
      ok: result.ok,
      copied: harness.adapter.loweredPlans.some(
        ({ command }) =>
          'pipeline' in command && JSON.stringify(command.pipeline.at(-1)).includes('$out'),
      ),
    }).toEqual({ ok: true, copied: true });
  });

  it.each([
    {
      reason: 'reading the counts fails',
      arrange: (harness: Harness) => harness.driver.failAggregateWith(LOST),
    },
    {
      reason: 'a count is too large for a JavaScript number to hold exactly',
      arrange: (harness: Harness) => {
        harness.driver.queueResponse([{ documents: 2 ** 53 }]);
        harness.driver.queueResponse([{ documents: 2 }]);
        harness.driver.failAggregateWith(LOST, COPY_COUNTS.length);
      },
    },
    {
      reason: 'a count is not a number',
      arrange: (harness: Harness) => {
        harness.driver.queueResponse([{ documents: { low: 3, high: 0 } }]);
        harness.driver.queueResponse([{ documents: 2 }]);
        harness.driver.failAggregateWith(LOST, COPY_COUNTS.length);
      },
    },
    {
      reason:
        'the two collections have different collations, so the copy selects with the collation of its target',
      arrange: (harness: Harness) => {
        harness.inspectionExecutor.collections = [
          { name: 'measurements', options: { collation: { locale: 'en', strength: 2 } } },
          { name: 'events', options: {} },
        ];
        harness.driver.queueResponse([{ documents: 3 }]);
        harness.driver.queueResponse([{ documents: 2 }]);
        harness.driver.failCopiesWith(LOST, harness.adapter);
      },
    },
  ])(
    'says to check that the copy has ended and settle both collections by hand when $reason',
    async ({ arrange }) => {
      const harness = makeHarness();
      arrange(harness);

      const result = await execute(harness, [unionCopy, deletion]);

      expect(failureFields(result.assertNotOk())).toMatchObject({
        code: 'MIGRATION.EXECUTION_FAILED',
        message: `Operation ${unionCopy.id} failed: connection 3 to 127.0.0.1:27017 closed`,
        why: `Fix what the error names, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. Operation ${unionCopy.id} was copying documents of collection events into collection measurements with an $out stage when the apply stopped. The error does not show whether the copy finished, and the runner has no count of the documents from before it that could show it. Before you do anything else, ${COPY_ENDED} Then ${SETTLE_BY_HAND('events')} The operations that ran before the failure stay applied.`,
      });
    },
  );

  it.each([
    { form: 'as the contract gives it', collation: { locale: 'en', strength: 2 } },
    {
      form: 'in the full form MongoDB reports',
      collation: {
        locale: 'en',
        caseLevel: false,
        caseFirst: 'off',
        strength: 2,
        numericOrdering: false,
        alternate: 'non-ignorable',
        maxVariable: 'punct',
        normalization: false,
        backwards: false,
        version: '57.1',
      },
    },
  ])(
    'counts a copy whose two collections have the same collation, $form',
    async ({ collation }) => {
      const harness = makeHarness();
      harness.inspectionExecutor.collections = [
        { name: 'measurements', options: { collation } },
        { name: 'events', options: { collation } },
      ];
      harness.driver.queueResponse([{ documents: 3 }]);
      harness.driver.queueResponse([{ documents: 2 }]);
      harness.driver.failAggregateWith(LOST, COPY_COUNTS.length);

      const result = await execute(harness, [unionCopy, deletion]);

      expect(failureFields(result.assertNotOk()).why).toContain(
        'Before the copy, collection measurements held 3 documents, and the copy was to add 2 documents of collection events.',
      );
    },
  );

  it('says to count again after a moment when the target holds what it held before a copy of the whole source, since the re-run may add its documents again', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ documents: 1 }]);
    harness.driver.queueResponse([{ documents: 4 }]);
    harness.driver.failAggregateWith(LOST, COPY_COUNTS.length);

    const result = await execute(harness, [renameCopy, dropCollection('readings')]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `If it holds 1, and ${UNCHANGED}, the copy most likely did not finish, but a majority count can lag behind the copy's last writes: wait a moment and count again. If it still holds 1, delete nothing, and run the command again as it is. Even then the copy may have finished, and the run then adds the documents of collection readings to collection measurements a second time: the query below finds them.`,
    );
  });

  it.each([
    {
      shape: 'an $out copy with a stage the planner does not write after its $match',
      copy: dataTransform('move one Measurement to measurements', {
        run: () =>
          rawAggregate('measurements', [
            { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }, { $limit: 100 }] } },
            { $out: 'measurements' },
          ]),
      }),
      into: 'measurements',
      stage: '$out',
    },
    {
      shape: 'a $merge copy with options the planner does not write',
      copy: dataTransform('move Member to members', {
        run: () =>
          rawAggregate('events', [
            { $match: FILTER },
            { $merge: { into: 'members', on: 'email' } },
          ]),
      }),
      into: 'members',
      stage: '$merge',
    },
    {
      shape: 'a $merge copy that sets _id',
      copy: dataTransform('move Member to members', {
        run: () =>
          rawAggregate('events', [
            { $match: FILTER },
            { $set: { _id: '$email' } },
            { $merge: { into: 'members' } },
          ]),
      }),
      into: 'members',
      stage: '$merge',
    },
  ])(
    'says a copy the runner does not recognise may have finished when it throws, and to settle both collections by hand before running again: $shape',
    async ({ copy, into, stage }) => {
      const harness = makeHarness();
      harness.driver.failAggregateWith(LOST);

      const result = await execute(harness, [copy, deletion]);

      expect(failureFields(result.assertNotOk())).toEqual({
        code: 'MIGRATION.EXECUTION_FAILED',
        message: `Operation ${copy.id} failed: connection 3 to 127.0.0.1:27017 closed`,
        why: UNRECOGNISED(copy.id, into, stage, 'the run would copy the documents again'),
        meta: { operationId: copy.id, databaseUnchanged: false },
      });
    },
  );

  it.each([
    { when: 'with postchecks on', executionChecks: undefined, rerun: CHECKED_RERUN },
    {
      when: 'not with postchecks off',
      executionChecks: { prechecks: true, postchecks: false, idempotencyChecks: true },
      rerun: 'the run would copy the documents again',
    },
  ])(
    'says a re-run copies again unless the check of a copy the runner does not recognise shows it ran, $when',
    async ({ executionChecks, rerun }) => {
      const copy = dataTransform('move Member to members', {
        check: { source: () => rawAggregate('members', [{ $match: FILTER }, { $limit: 1 }]) },
        run: () =>
          rawAggregate('events', [
            { $match: FILTER },
            { $merge: { into: 'members', on: 'email' } },
          ]),
      });
      const harness = makeHarness();
      for (const _ of ['idempotency check', 'precheck']) harness.driver.queueResponse([{ _id: 1 }]);
      harness.driver.failCopiesWith(LOST, harness.adapter);

      const result = await execute(harness, [copy, deletion], executionChecks);

      expect(failureFields(result.assertNotOk()).why).toBe(
        UNRECOGNISED(copy.id, 'members', '$merge', rerun),
      );
    },
  );

  it.each([
    {
      shape: 'with no stage between its $match and $merge',
      pipeline: [{ $match: FILTER }, { $merge: { into: 'members' } }],
      options: undefined,
    },
    {
      shape: 'with the $set and $unset stages that rename fields, skipping validation',
      pipeline: [
        { $match: FILTER },
        { $set: { fullName: '$name', kind: { $literal: 'member' } } },
        { $unset: ['name'] },
        { $merge: { into: 'members' } },
      ],
      options: { bypassDocumentValidation: true },
    },
  ])(
    'passes on what a move the planner prints into a collection that is not time-series throws, since its merge stage matches by _id and a re-run is safe: $shape',
    async ({ pipeline, options }) => {
      const copy = dataTransform('move Member to members', {
        run: () => rawAggregate('events', pipeline, options),
      });
      const harness = makeHarness();
      harness.driver.failAggregateWith(LOST);

      await expect(execute(harness, [copy, deletion])).rejects.toBe(LOST);
    },
  );

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
      'If it holds 5, and nothing wrote to or deleted from either collection since the apply started, the copy finished',
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
    { drop: 'runs', operation: dropCollection('readings'), drops: ['ddl:dropCollection:readings'] },
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
      drops: [],
    },
  ])(
    'throws the error of a callback after the drop of the source as it is, when the drop $drop',
    async ({ operation, drops }) => {
      const harness = makeHarness();
      const broke = new Error('the progress display broke');

      await expect(
        execute(harness, [renameCopy, operation], undefined, {
          onOperationComplete: (completed) => {
            if (completed.id === operation.id) throw broke;
          },
        }),
      ).rejects.toBe(broke);
      expect(harness.ddlCalls).toEqual(drops);
    },
  );

  it('keeps the failure of an operation when the callback after it also throws', async () => {
    const harness = makeHarness();
    for (const rows of [...COPY_COUNTS, [], [{ _id: 1 }]]) harness.driver.queueResponse(rows);
    harness.driver.failUpdateManyWith(badValue);

    const result = await execute(harness, [unionCopy, deletion], undefined, {
      onOperationComplete: (operation) => {
        if (operation.id === deletion.id) throw new Error('the progress display broke');
      },
    });

    expect(failureFields(result.assertNotOk())).toMatchObject({
      message: `Operation ${deletion.id} failed: MongoDB error 2 (BadValue): bad value`,
      why: expect.stringContaining(unfinished),
    });
  });

  it('keeps the error an operation throws when the callback after it also throws', async () => {
    const harness = makeHarness();
    for (const rows of [...COPY_COUNTS, [], [{ _id: 1 }]]) harness.driver.queueResponse(rows);
    harness.driver.failUpdateManyWith(LOST);

    const result = await execute(harness, [unionCopy, deletion], undefined, {
      onOperationComplete: (operation) => {
        if (operation.id === deletion.id) throw new Error('the progress display broke');
      },
    });

    expect(failureFields(result.assertNotOk()).message).toBe(
      `Operation ${deletion.id} failed: connection 3 to 127.0.0.1:27017 closed`,
    );
  });

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
