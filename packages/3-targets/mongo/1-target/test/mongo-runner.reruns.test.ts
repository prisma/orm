import {
  type AnyMongoMigrationOperation,
  MongoExistsExpr,
} from '@internal/mongo-query-ast/control';
import { MongoFieldFilter } from '@internal/mongo-query-ast/execution';
import { MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  castField,
  createCollection,
  createIndex,
  dataTransform,
  rawAggregate,
  rawUpdateMany,
  removeStoredValue,
  renameCollection,
  renameField,
  renameStoredKey,
  replaceStoredValue,
  unsetField,
} from '../src/core/migrations/migration-factories';
import {
  execute,
  failureFields,
  type Harness,
  makeHarness,
  makeRunPlan,
  type Row,
  RUN_COLLECTION,
} from './mongo-runner-harness';

describe('MongoMigrationRunner, a stop after a copy, which has no check', () => {
  const copy = dataTransform('move User to posts', {
    run: () => rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'posts' } }]),
  });

  it('says at a field rename collision that the copy runs again', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([]);
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.queueResponse([{ _id: 2 }]);

    const result = await execute(harness, [
      copy,
      renameField('posts', 'title', 'headline', { filter: { type: 'bug' } }),
    ]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      'Once the documents are fixed, run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again.',
    );
  });

  it('says at a collection rename whose new collection exists that the copy runs again', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'events' }, { name: 'occasions' }];

    const result = await execute(harness, [copy, renameCollection('events', 'occasions')]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      'If occasions holds nothing you need, drop it, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again. If an earlier operation',
    );
  });

  it('says that every operation runs again when idempotency checks are off', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([]);
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.queueResponse([{ _id: 2 }]);

    const result = await execute(
      harness,
      [copy, renameField('posts', 'title', 'headline', { filter: { type: 'bug' } })],
      { prechecks: true, postchecks: true, idempotencyChecks: false },
    );

    expect(failureFields(result.assertNotOk()).why).toContain(
      'Once the documents are fixed, run the command again. With postchecks or idempotency checks turned off, a run skips no operation, so each operation that already ran runs again.',
    );
  });

  it('says that an operation with no check runs again when it is a create from an ops.json written before creates had one', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'events' }, { name: 'occasions' }];
    const uncheckedCreate = { ...createCollection('members'), postcheck: [] };

    const result = await execute(harness, [
      uncheckedCreate,
      renameCollection('events', 'occasions'),
    ]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      'If occasions holds nothing you need, drop it, then run the command again. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again.',
    );
  });

  const mongoError = (code: number, codeName: string, extra: Record<string, unknown> = {}) =>
    new MongoServerError({ ok: 0, code, codeName, errmsg: `${codeName} error`, ...extra });
  const runsAgain =
    'An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again.';
  const stillMatching = [[{ _id: 1 }], [], [{ _id: 1 }], [{ documents: 1, documentId: 3 }]];

  it.each<{
    readonly stop: string;
    readonly harness?: Parameters<typeof makeHarness>[0];
    readonly setUp?: (harness: Harness) => void;
    readonly responses?: readonly Row[][];
    readonly operation: AnyMongoMigrationOperation;
    readonly says: string;
  }>([
    {
      stop: 'a key rename collision',
      responses: [[{ _id: 1 }], [{ _id: 2 }]],
      operation: renameStoredKey({
        collection: 'orders',
        field: 'lines',
        path: '$[*].sku',
        to: 'code',
      }),
      says: 'Once the documents are fixed, run the command again.',
    },
    {
      stop: 'a rewrite that would duplicate a unique key',
      responses: [[{ _id: 1 }]],
      setUp: (harness) =>
        harness.driver.failUpdateManyWith(
          mongoError(11000, 'DuplicateKey', {
            errmsg: 'E11000 index: code_1 dup key: { code: 1 }',
          }),
        ),
      operation: castField({ collection: 'users', field: 'code', from: ['string'], to: 'int' }),
      says: 'Change or remove the documents that would collide, then run the command again.',
    },
    {
      stop: 'a unique index that cannot be built',
      harness: { ddlError: mongoError(11000, 'DuplicateKey', { keyValue: { email: 'a' } }) },
      operation: createIndex('orders', [{ field: 'email', direction: 1 }], { name: 'email_1' }),
      says: 'Give each document its own value of the indexed fields, or remove the duplicates, then run the command again.',
    },
    {
      stop: 'a removed value that documents still hold',
      responses: [[{ _id: 1 }], [{ _id: 2 }], [{ documents: 2, documentId: 5 }]],
      operation: removeStoredValue({
        collection: 'users',
        field: 'status',
        value: 'archived',
        required: true,
      }),
      says: 'Once the documents are fixed, run the command again.',
    },
    {
      stop: "documents a planner rewrite's update did not change",
      responses: stillMatching,
      operation: replaceStoredValue({
        collection: 'users',
        field: 'status',
        from: 'old',
        to: 'new',
      }),
      says: 'Run the command again.',
    },
    {
      stop: "documents a data transform's update did not change",
      responses: [[{ _id: 1 }], ...stillMatching],
      operation: dataTransform('fix status', {
        check: { source: () => rawAggregate('users', [{ $match: { status: 'old' } }]) },
        run: () => makeRunPlan(),
      }),
      says: "Change the update in the migration's migration.ts so it changes them too, run the file with node, then run the command again.",
    },
    {
      stop: 'a user who may not skip document validation',
      responses: [[{ _id: 1 }]],
      setUp: (harness) => harness.driver.failUpdateManyWith(mongoError(13, 'Unauthorized')),
      operation: unsetField('users', 'nickname'),
      says: 'Then run the command again.',
    },
    {
      stop: 'a create onto an existing collection',
      setUp: (harness) => {
        harness.inspectionExecutor.collections = [{ name: 'orders' }];
      },
      operation: createCollection('orders'),
      says: 'If orders holds nothing you need, drop it, then run the command again.',
    },
    {
      stop: "a data transform's update that meets a value it cannot convert",
      setUp: (harness) => harness.driver.failUpdateManyWith(mongoError(241, 'ConversionFailure')),
      operation: dataTransform('backfill-status', { run: () => makeRunPlan() }),
      says: "Fix the update in the migration's migration.ts, run the file with node, then run the command again.",
    },
    {
      stop: "any other failure of a data transform's update",
      setUp: (harness) => harness.driver.failUpdateManyWith(mongoError(2, 'BadValue')),
      operation: dataTransform('backfill-status', { run: () => makeRunPlan() }),
      says: 'Then run the command again.',
    },
  ])(
    'says at $stop that the copy runs again',
    async ({ harness: options, setUp, responses = [], operation, says }) => {
      const harness = makeHarness(options);
      setUp?.(harness);
      for (const rows of [[], ...responses]) harness.driver.queueResponse(rows);

      const result = await execute(harness, [copy, operation]);

      expect(failureFields(result.assertNotOk()).why).toContain(`${says} ${runsAgain}`);
    },
  );
});

describe("MongoMigrationRunner, a data transform's update that stops part way", () => {
  const withCheck = (checkFilter: Record<string, unknown>) =>
    dataTransform('backfill-status', {
      check: {
        source: () => rawAggregate(RUN_COLLECTION, [{ $match: checkFilter }, { $limit: 1 }]),
      },
      run: () => makeRunPlan(),
    });
  const runsAgain =
    '. An operation whose check shows it already ran is skipped; an operation with no check, such as a copy in a dataTransform, runs again.';
  const skipped = '; operations that already ran are skipped.';
  const changesTheRest =
    'When the command runs again, this update changes only the documents its filter still selects, the same documents its check finds. A document it already took out of that filter is not changed again. A document it changed but left inside that filter, as an update of only other fields does, is changed again.';
  const mayRunOverChanged =
    'When the command runs again, this update runs again over every document its filter selects then. If that filter still selects documents it already changed, make the update give the same result when it runs twice, or restore those documents before you run the command again.';
  const conversion = new MongoServerError({
    ok: 0,
    code: 241,
    codeName: 'ConversionFailure',
    errmsg: "Failed to parse number 'G1' in $convert",
  });
  const badValue = new MongoServerError({
    ok: 0,
    code: 2,
    codeName: 'BadValue',
    errmsg: 'bad value',
  });
  const conversionWhy = (rerun: string, after: string) =>
    `MongoDB stopped the data transform's update: Failed to parse number 'G1' in $convert. Documents it updated before that value stay updated. Until a re-run finishes, a document the update already changed may no longer fit the collection's current validator, so updates to it fail. ${rerun} Fix the update in the migration's migration.ts, run the file with node, then run the command again${after} The operations that ran before the failure stay applied.`;
  const otherWhy = (rerun: string, after: string) =>
    `Documents the update changed before the error stay changed. Until a re-run finishes, a document the update already changed may no longer fit the collection's current validator, so updates to it fail. ${rerun} Fix what MongoDB names; when it comes from the update, change it in the migration's migration.ts and run the file with node. Then run the command again${after} The operations that ran before the failure stay applied.`;

  it.each([
    {
      stop: 'a value it cannot convert',
      error: conversion,
      why: conversionWhy(mayRunOverChanged, runsAgain),
    },
    { stop: 'any other error', error: badValue, why: otherWhy(mayRunOverChanged, runsAgain) },
  ])(
    'says at $stop, for an update with no check, that it runs again over every document its filter selects',
    async ({ error, why }) => {
      const harness = makeHarness();
      harness.driver.failUpdateManyWith(error);
      harness.driver.queueResponse([]);

      const result = await execute(harness, [
        dataTransform('backfill-status', { run: () => makeRunPlan() }),
      ]);

      expect(failureFields(result.assertNotOk()).why).toBe(why);
    },
  );

  it.each([
    {
      stop: 'a value it cannot convert',
      error: conversion,
      why: conversionWhy(changesTheRest, skipped),
    },
    { stop: 'any other error', error: badValue, why: otherWhy(changesTheRest, skipped) },
  ])(
    "says at $stop, for an update whose filter is its check's, that a re-run changes only the rest",
    async ({ error, why }) => {
      const harness = makeHarness();
      harness.driver.failUpdateManyWith(error);
      harness.driver.queueResponse([{ _id: 1 }]);
      harness.driver.queueResponse([{ _id: 1 }]);

      const result = await execute(harness, [withCheck({ status: { $exists: false } })]);

      expect(failureFields(result.assertNotOk()).why).toBe(why);
    },
  );

  it("says an update whose filter is its check's changes again on a re-run a document it changed but left in that filter, such as with an $inc", async () => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(badValue);
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.queueResponse([{ _id: 1 }]);
    const runFilter = { status: { $exists: false } };

    const result = await execute(harness, [
      dataTransform('count-attempts', {
        check: {
          source: () => rawAggregate(RUN_COLLECTION, [{ $match: runFilter }, { $limit: 1 }]),
        },
        run: () => rawUpdateMany(RUN_COLLECTION, runFilter, { $inc: { attempts: 1 } }),
      }),
    ]);

    expect(failureFields(result.assertNotOk()).why).toContain(
      'A document it changed but left inside that filter, as an update of only other fields does, is changed again.',
    );
  });

  it("says a re-run may run over the documents it changed when the update's filter is not its check's", async () => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(badValue);
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.queueResponse([{ _id: 1 }]);

    const result = await execute(harness, [withCheck({ status: null })]);

    expect(failureFields(result.assertNotOk()).why).toBe(otherWhy(mayRunOverChanged, skipped));
  });

  const runFilter = { status: { $exists: false } };
  it.each([
    {
      nearMiss: 'whose check reads another collection',
      check: { source: () => rawAggregate('accounts', [{ $match: runFilter }, { $limit: 1 }]) },
      rows: [{ _id: 1 }],
    },
    {
      nearMiss: 'whose check narrows its $match with a later stage',
      check: {
        source: () =>
          rawAggregate(RUN_COLLECTION, [
            { $match: runFilter },
            { $match: { plan: 'free' } },
            { $limit: 1 },
          ]),
      },
      rows: [{ _id: 1 }],
    },
    {
      nearMiss: 'whose postcheck expects a document',
      check: {
        source: () => rawAggregate(RUN_COLLECTION, [{ $match: runFilter }, { $limit: 1 }]),
        expect: 'notExists' as const,
      },
      rows: [],
    },
    {
      nearMiss: 'whose check has a filter of its own',
      check: {
        source: () => rawAggregate(RUN_COLLECTION, [{ $match: runFilter }, { $limit: 1 }]),
        filter: MongoFieldFilter.eq('_id', 1),
      },
      rows: [{ _id: 1 }],
    },
    {
      nearMiss: 'whose check asks whether another field exists',
      check: {
        source: () => rawAggregate(RUN_COLLECTION, [{ $match: runFilter }, { $limit: 1 }]),
        filter: MongoExistsExpr.exists('email'),
      },
      rows: [{ _id: 1, email: 'ada@example.com' }],
    },
  ])(
    'says a re-run may run over the documents it changed for an update $nearMiss',
    async ({ check, rows }) => {
      const harness = makeHarness();
      harness.driver.failUpdateManyWith(badValue);
      harness.driver.queueResponse(rows);
      harness.driver.queueResponse(rows);

      const result = await execute(harness, [
        dataTransform('backfill-status', { check, run: () => makeRunPlan() }),
      ]);

      expect(failureFields(result.assertNotOk()).why).toBe(otherWhy(mayRunOverChanged, skipped));
    },
  );
});
