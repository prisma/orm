import { MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  dataTransform,
  deleteDocuments,
  rawAggregate,
} from '../src/core/migrations/migration-factories';
import { execute, failureFields, makeHarness, makeRunPlan } from './mongo-runner-harness';

const FILTER = { at: { $exists: true } };
const unionCopy = dataTransform('move Measurement to measurements', {
  run: () =>
    rawAggregate('measurements', [
      { $unionWith: { coll: 'events', pipeline: [{ $match: FILTER }] } },
      { $out: 'measurements' },
    ]),
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

const unfinished = `Operation data_transform.move Measurement to measurements copied documents into collection measurements with an $out stage, and operation ${deletion.id}, which deletes them from collection events, has not finished. Before you run the command again, finish that delete yourself, on collection events with the filter of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection events to collection measurements a second time. Do not delete documents from collection measurements instead.`;

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

  it('says nothing about the copy once the delete has finished', async () => {
    const harness = makeHarness();
    for (const rows of [[], [{ _id: 1 }], [], [], [{ _id: 1 }], []]) {
      harness.driver.queueResponse(rows);
    }

    const result = await execute(harness, [unionCopy, deletion, checkedTransform]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.PRECHECK_FAILED',
      why: 'The operations that ran before the failure stay applied.',
    });
  });

  it('says in plain words what a re-run does when no delete follows the copy', async () => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(badValue);

    const result = await execute(harness, [unionCopy, failingUpdate]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      'Operation data_transform.move Measurement to measurements copied documents into collection measurements with an $out stage, and it has no check, so it runs again. If the documents it copied are still in collection events and are meant to leave it, delete them there before you run the command again: otherwise the copy adds them to collection measurements a second time. The operations that ran before the failure stay applied.',
    );
  });

  it('says a copy that reads only its source empties its target once the delete has finished', async () => {
    const harness = makeHarness();
    for (const rows of [[], [{ _id: 1 }], [], [], [{ _id: 1 }], []]) {
      harness.driver.queueResponse(rows);
    }

    const result = await execute(harness, [loneCopy, deletion, checkedTransform]);

    expect(failureFields(result.assertNotOk()).why).toBe(
      `Operation data_transform.move Measurement to measurements copied documents from collection events into collection measurements with an $out stage, which replaces everything collection measurements holds, and operation ${deletion.id} has since deleted them from collection events. The copy has no check, so it runs again, and it would then empty collection measurements. Before you run the command again, change the copy in the migration's migration.ts to read collection measurements and add the documents of collection events with a $unionWith stage, as rawAggregate("measurements", [{ $unionWith: { coll: "events", pipeline: [<its stages before the $out>] } }, { $out: "measurements" }]) does, and run the file with node. The operations that ran before the failure stay applied.`,
    );
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
