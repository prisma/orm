import { InternalError } from '@internal/utils/internal-error';
import { MongoServerError } from 'mongodb';
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
const copyAndDelete = [[], [{ _id: 1 }], [], []];
const stopsAtCheckedTransform = [...copyAndDelete, [{ _id: 1 }], []];

const DUPLICATES = `To find them, group collection measurements by _id and keep each _id that appears more than once, for example with db.getCollection("measurements").aggregate([{ $group: { _id: '$_id', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]) in mongosh.`;

const unfinished = `Operation data_transform.move Measurement to measurements copied documents into collection measurements with an $out stage, and operation ${deletion.id}, which deletes them from collection events, has not finished. Before you run the command again, finish that delete yourself, on collection events with the filter of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If the command was already run again before the delete finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES}`;

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
    harness.driver.queueResponse([]);
    harness.driver.queueResponse([{ _id: 1 }]);
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
    harness.driver.queueResponse([]);
    harness.driver.queueResponse([{ _id: 1 }]);
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
    for (const rows of [[], [], [{ _id: 1 }], [], []]) harness.driver.queueResponse(rows);
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
      `Operation data_transform.move Measurement and Sample to measurements copied documents into collection measurements with an $out stage, and operations ${deletion.id} and ${sampleDeletion.id}, which delete them from collection events, have not finished. Before you run the command again, finish those deletes yourself, on collection events, each with the filter of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If the command was already run again before the deletes finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES}`,
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
    for (const rows of stopsAtCheckedTransform) harness.driver.queueResponse(rows);

    const result = await execute(harness, [groupsCopy, deletion, checkedTransform, sampleDeletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      why: expect.stringContaining(
        `with an $out stage, and operation ${sampleDeletion.id}, which deletes them from collection events, has not finished.`,
      ),
    });
  });

  it('pairs a copy whose stages rename the field its filter reads', async () => {
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

    expect(failureFields(result.assertNotOk()).why).toContain(unfinished);
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
      `Operation data_transform.copy readings to measurements copied the documents of collection readings into collection measurements with an $out stage, and operation ${drop.id}, which drops collection readings, has not run. Before you run the command again, delete the documents of collection readings or drop it yourself: the copy has no check, so it runs again, and it would add the documents of collection readings to collection measurements a second time. Do not delete documents from collection measurements instead. If the command was already run again before collection readings was dropped, its documents are in collection measurements more than once: each of them is there two or more times, under the same _id. ${DUPLICATES} The operations that ran before the failure stay applied.`,
    );
  });

  it('says nothing about a copy of the whole source once its drop has run', async () => {
    const harness = makeHarness();
    for (const rows of [[], [{ _id: 1 }], []]) harness.driver.queueResponse(rows);

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

  it('says a copy that threw while it ran may have finished, and how to tell, when its delete has not run', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(new Error('connection 3 to 127.0.0.1:27017 closed'));

    const result = await execute(harness, [unionCopy, deletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      message: `Operation ${unionCopy.id} failed: connection 3 to 127.0.0.1:27017 closed`,
      why: `Fix what the error names, then run the command again; operations that already ran are skipped. Operation ${unionCopy.id} was copying documents into collection measurements with an $out stage when the apply stopped, and the copy may have finished: the error does not show whether the $out stage replaced collection measurements. Operation ${deletion.id}, which deletes them from collection events, has not run. To tell, look in collection measurements for the _id of a document of collection events that the filter of its deleteDocuments call selects. If the copy finished, before you run the command again, run that delete yourself, on collection events with the filter of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead. If the copy did not finish, run the command again as it is. If the copy finished and the command was already run again before the delete finished, collection measurements holds some of the moved documents two or more times, under the same _id. ${DUPLICATES} The operations that ran before the failure stay applied.`,
      meta: { operationId: unionCopy.id, databaseUnchanged: false },
    });
  });

  it('says a copy of the whole source that threw while it ran may have finished, when its drop has not run', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(new Error('connection 3 to 127.0.0.1:27017 closed'));
    const drop = dropCollection('readings');

    const result = await execute(harness, [renameCopy, drop]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      `Operation ${renameCopy.id} was copying the documents of collection readings into collection measurements with an $out stage when the apply stopped, and the copy may have finished: the error does not show whether the $out stage replaced collection measurements. Operation ${drop.id}, which drops collection readings, has not run. To tell, look in collection measurements for the _id of a document of collection readings. If the copy finished, before you run the command again, delete the documents of collection readings or drop it yourself:`,
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
    harness.driver.failAggregateWith(badValue);

    const result = await execute(harness, [unionCopy, deletion]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      message:
        'Operation data_transform.move Measurement to measurements failed: MongoDB error 2 (BadValue): bad value',
      why: "Collection measurements is as it was: an $out stage replaces it only when the whole pipeline succeeds. Fix what MongoDB names; when it comes from the copy, change its pipeline in the migration's migration.ts and run the file with node. Then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. The operations that ran before the failure stay applied.",
    });
  });
});
