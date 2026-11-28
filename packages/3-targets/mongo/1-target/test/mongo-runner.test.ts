import type {
  MarkerOperations,
  MongoRunnerDependencies,
} from '@internal/family-mongo/control-adapter';
import type {
  MigrationPlan,
  MigrationRunnerExecutionChecks,
} from '@internal/framework-components/control';
import type { AggregateMigrationEdgeRef } from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import {
  type AnyMongoMigrationOperation,
  CollModCommand,
  MongoExistsExpr,
} from '@internal/mongo-query-ast/control';
import { RawAggregateCommand } from '@internal/mongo-query-ast/execution';
import { MongoSchemaCollection, MongoSchemaIR } from '@internal/mongo-schema-ir';
import { isStructuredError } from '@internal/utils/structured-error';
import { ObjectId, UUID } from 'bson';
import { MongoServerError } from 'mongodb';
import { describe, expect, it } from 'vitest';
import {
  castField,
  createCollection,
  createIndex,
  dataTransform,
  rawAggregate,
  rawUpdateMany,
  renameCollection,
  renameField,
  unsetField,
} from '../src/core/migrations/migration-factories';
import { MongoMigrationRunner } from '../src/core/migrations/mongo-runner';
import {
  ALL_POLICY,
  execute,
  failureFields,
  makeCheckPlan,
  makeContract,
  makeHarness,
  makePlan,
  makeRunPlan,
  makeWriteCheckPlan,
  NOOP_MARKER_OPS,
  PLAN_META,
  RUN_COLLECTION,
  StubInspectionExecutor,
  StubMongoAdapter,
  StubMongoDriver,
  serializedOperations,
  synthEdges,
} from './mongo-runner-harness';

describe('MongoMigrationRunner.executeDmlOperation', () => {
  it('runs the DML wire command once when there are no checks to gate it', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', { run: () => makeRunPlan() });

    const result = await execute(harness, [op]);

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 1,
      changedDatabase: true,
    });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'updateMany', collection: RUN_COLLECTION },
    ]);
    expect(harness.adapter.loweredPlans).toHaveLength(1);
    expect(harness.adapter.loweredPlans[0]?.command.kind).toBe('rawUpdateMany');
  });

  it('skips run when the postcheck probe reports the transform is already satisfied', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // Postcheck defaults to `expect: 'notExists'` — returning zero rows means
    // the transform is already satisfied, so the runner short-circuits.
    harness.driver.queueResponse([]);

    const result = await execute(harness, [op]);

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 0,
      changedDatabase: true,
    });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'aggregate', collection: RUN_COLLECTION },
    ]);
  });

  it('fails with PRECHECK_FAILED and does not run the transform when the precheck is violated', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // Precheck expects `exists`; an empty response from the probe means the
    // required precondition is not met.
    harness.driver.queueResponse([]);

    const result = await execute(harness, [op], { idempotencyChecks: false });

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message: `Operation ${op.id} failed during precheck`,
      why: 'The failed apply changed nothing.',
      meta: { operationId: op.id, name: op.name, databaseUnchanged: true },
    });
    expect(harness.driver.executeCalls).toEqual([
      { kind: 'aggregate', collection: RUN_COLLECTION },
    ]);
  });

  it('fails with POSTCHECK_FAILED after the run when the postcheck is violated', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeCheckPlan() },
      run: () => makeRunPlan(),
    });
    // 1) precheck probe (expect: 'exists') — rows present → passes.
    harness.driver.queueResponse([{ _id: 'u1' }]);
    // 2) run — consumes the driver but we don't yield rows.
    harness.driver.queueResponse([]);
    // 3) postcheck probe (expect: 'notExists') — rows present → fails.
    harness.driver.queueResponse([{ _id: 'u1' }]);

    const result = await execute(harness, [op], { idempotencyChecks: false });

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.POSTCHECK_FAILED',
      message: `Operation ${op.id} failed during postcheck`,
      why: 'The operations that ran before the failure stay applied.',
      meta: { operationId: op.id, name: op.name, databaseUnchanged: false },
    });
    expect(harness.driver.executeCalls.map((c) => c.kind)).toEqual([
      'aggregate',
      'updateMany',
      'aggregate',
    ]);
  });

  it.each([
    ['changed no document', { matchedCount: 0, modifiedCount: 0 }, true],
    ['changed a document', { matchedCount: 1, modifiedCount: 1 }, false],
  ])(
    'says whether the database changed when a run that %s fails its postcheck',
    async (_, runResult, databaseUnchanged) => {
      const harness = makeHarness();
      const op = dataTransform('backfill-status', {
        check: { source: () => makeCheckPlan() },
        run: () => makeRunPlan(),
      });
      harness.driver.queueResponse([{ _id: 'u1' }]);
      harness.driver.queueResponse([runResult]);
      harness.driver.queueResponse([{ _id: 'u1' }]);

      const result = await execute(harness, [op], { idempotencyChecks: false });

      expect(failureFields(result.assertNotOk())).toMatchObject({
        code: 'MIGRATION.POSTCHECK_FAILED',
        meta: { databaseUnchanged },
      });
    },
  );

  it('rejects a check whose source is not an aggregate command before invoking driver.execute', async () => {
    const harness = makeHarness();
    const op = dataTransform('backfill-status', {
      check: { source: () => makeWriteCheckPlan() },
      run: () => makeRunPlan(),
    });

    let thrown: unknown;
    try {
      await execute(harness, [op], { idempotencyChecks: false });
    } catch (error) {
      thrown = error;
    }

    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({
      code: 'MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY',
      meta: {
        commandKind: 'rawUpdateMany',
        collection: RUN_COLLECTION,
      },
    });
    expect((thrown as Error).message).toContain('rawUpdateMany');
    expect(harness.driver.executeCalls).toEqual([]);
  });

  it.each(['$out', '$merge'])(
    'rejects a check whose aggregate writes with %s before invoking driver.execute',
    async (stage) => {
      const harness = makeHarness();
      const op = dataTransform('backfill-status', {
        check: {
          source: () => ({
            collection: RUN_COLLECTION,
            command: new RawAggregateCommand(RUN_COLLECTION, [{ $match: {} }, { [stage]: 'copy' }]),
            meta: PLAN_META,
          }),
        },
        run: () => makeRunPlan(),
      });

      await expect(execute(harness, [op], { idempotencyChecks: false })).rejects.toMatchObject({
        code: 'MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY',
        message: `Migration check rejected: stage "${stage}" is not read-only`,
        meta: { stage, collection: RUN_COLLECTION },
      });
      expect(harness.driver.executeCalls).toEqual([]);
    },
  );

  it('dispatches DDL ops through executeDdl seam and data ops through adapter.lower + driver.execute, in plan order', async () => {
    const harness = makeHarness();
    const ddlOp = createCollection('orders');
    const dataOp = dataTransform('seed-orders', { run: () => makeRunPlan() });

    const result = await execute(harness, [ddlOp, dataOp], {
      prechecks: false,
      postchecks: false,
      idempotencyChecks: false,
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 2,
      operationsExecuted: 2,
      changedDatabase: true,
    });
    expect(harness.ddlCalls).toEqual(['ddl:createCollection:orders']);
    expect(harness.driver.executeCalls).toHaveLength(1);
    expect(harness.driver.executeCalls[0]).toMatchObject({
      kind: 'updateMany',
      collection: RUN_COLLECTION,
    });
    expect(harness.log.entries).toEqual([
      'ddl:createCollection:orders',
      `dml:updateMany:${RUN_COLLECTION}`,
    ]);
  });
});

describe('MongoMigrationRunner schema verification', () => {
  interface MarkerCallLog {
    readonly initMarker: number;
    readonly updateMarker: number;
    readonly writeLedgerEntry: number;
  }

  function makeTrackingMarkerOps(): { ops: MarkerOperations; calls: MarkerCallLog } {
    const calls = { initMarker: 0, updateMarker: 0, writeLedgerEntry: 0 };
    const ops: MarkerOperations = {
      markerLocation: '_prisma_migrations',
      readMarker: async () => null,
      initMarker: async () => {
        calls.initMarker++;
      },
      updateMarker: async () => {
        calls.updateMarker++;
        return true;
      },
      writeLedgerEntry: async () => {
        calls.writeLedgerEntry++;
      },
    };
    return { ops, calls };
  }

  function makeHarnessWithDrift(): {
    runner: MongoMigrationRunner;
    calls: MarkerCallLog;
  } {
    const { ops, calls } = makeTrackingMarkerOps();
    const driver = new StubMongoDriver();
    const adapter = new StubMongoAdapter();
    const inspectionExecutor = new StubInspectionExecutor();
    const driftIR = new MongoSchemaIR([new MongoSchemaCollection({ name: 'rogue' })], {
      fromDatabase: false,
    });
    const deps: MongoRunnerDependencies = {
      inspectionExecutor,
      adapter,
      driver,
      executeDdl: async () => {},
      markerOps: ops,
      introspectSchema: async () => driftIR,
    };
    return { runner: new MongoMigrationRunner(deps), calls };
  }

  it('returns SCHEMA_VERIFY_FAILED with issues when live schema diverges from contract', async () => {
    const { runner, calls } = makeHarnessWithDrift();
    const ddlOp = createCollection('orders');

    const driftPlan = makePlan([ddlOp]);
    const result = await runner.execute({
      plan: driftPlan,
      migrationEdges: synthEdges(driftPlan),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
      executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
    });

    const failure = result.assertNotOk();
    expect(failure.code).toBe('MIGRATION.SCHEMA_VERIFY_FAILED');
    expect(failure.why).toBe(
      'The schema check after apply found: extra: rogue. The operations that ran before the failure stay applied.',
    );
    expect(failure.meta).toEqual({
      databaseUnchanged: false,
      schemaIssues: expect.arrayContaining([expect.objectContaining({ path: ['rogue'] })]),
    });
    expect(calls).toEqual({ initMarker: 0, updateMarker: 0, writeLedgerEntry: 0 });
  });

  it('skips verification when the no-op short-circuit fires (no operations + marker matches destination)', async () => {
    const { ops, calls } = makeTrackingMarkerOps();
    const trackingReadMarker: MarkerOperations = {
      ...ops,
      readMarker: async () => ({
        storageHash: 'dest',
        profileHash: 'dest',
        contractJson: null,
        canonicalVersion: null,
        updatedAt: new Date(),
        appTag: null,
        meta: {},
        invariants: [],
      }),
    };
    let introspectCalls = 0;
    const driver = new StubMongoDriver();
    const adapter = new StubMongoAdapter();
    const inspectionExecutor = new StubInspectionExecutor();
    const driftIR = new MongoSchemaIR([new MongoSchemaCollection({ name: 'rogue' })], {
      fromDatabase: false,
    });
    const deps: MongoRunnerDependencies = {
      inspectionExecutor,
      adapter,
      driver,
      executeDdl: async () => {},
      markerOps: trackingReadMarker,
      introspectSchema: async () => {
        introspectCalls++;
        return driftIR;
      },
    };

    const runner = new MongoMigrationRunner(deps);
    const noOpPlan: MigrationPlan = {
      targetId: 'mongo',
      origin: { storageHash: 'dest' },
      destination: { storageHash: 'dest' },
      operations: [] as unknown as MigrationPlan['operations'],
    };
    const result = await runner.execute({
      plan: noOpPlan,
      migrationEdges: synthEdges(noOpPlan),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 0,
      operationsExecuted: 0,
      changedDatabase: false,
    });
    expect(introspectCalls).toBe(0);
    expect(calls).toEqual({ initMarker: 0, updateMarker: 0, writeLedgerEntry: 0 });
  });

  it('treats out-of-band collections as warnings under strictVerification: false', async () => {
    const { runner, calls } = makeHarnessWithDrift();
    const ddlOp = createCollection('orders');

    const warnPlan = makePlan([ddlOp]);
    const result = await runner.execute({
      plan: warnPlan,
      migrationEdges: synthEdges(warnPlan),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 1,
      changedDatabase: true,
    });
    expect(calls.initMarker).toBe(1);
    expect(calls.writeLedgerEntry).toBe(1);
  });
});

const LEDGER_TEST_SPACE_ID = 'ledger-test';

type LedgerEntryPayload = Parameters<MarkerOperations['writeLedgerEntry']>[1];

function makeLedgerHarness(): {
  runner: MongoMigrationRunner;
  ledgerEntries: LedgerEntryPayload[];
} {
  const ledgerEntries: LedgerEntryPayload[] = [];
  const markerOps: MarkerOperations = {
    markerLocation: '_prisma_migrations',
    readMarker: async () => null,
    initMarker: async () => {},
    updateMarker: async () => true,
    writeLedgerEntry: async (_space, entry) => {
      ledgerEntries.push(entry);
    },
  };
  const deps: MongoRunnerDependencies = {
    inspectionExecutor: new StubInspectionExecutor(),
    adapter: new StubMongoAdapter(),
    driver: new StubMongoDriver(),
    executeDdl: async () => {},
    markerOps,
    introspectSchema: async () => new MongoSchemaIR([], { fromDatabase: false }),
  };
  return { runner: new MongoMigrationRunner(deps), ledgerEntries };
}

function makeLedgerPlan(
  ops: readonly AnyMongoMigrationOperation[],
  options: {
    readonly destinationHash?: string;
    readonly migrationEdges?: readonly AggregateMigrationEdgeRef[];
  } = {},
): MigrationPlan {
  return {
    targetId: 'mongo',
    spaceId: LEDGER_TEST_SPACE_ID,
    origin: null,
    destination: { storageHash: options.destinationHash ?? 'dest' },
    operations: serializedOperations(ops) as unknown as MigrationPlan['operations'],
  };
}

const LEDGER_EXECUTION_CHECKS: MigrationRunnerExecutionChecks = {
  prechecks: false,
  postchecks: false,
  idempotencyChecks: false,
};

describe('MongoMigrationRunner - per-edge ledger', () => {
  it('writes one ledger entry for a single-edge apply with space, name, hash, from/to, and that edge ops', async () => {
    const { runner, ledgerEntries } = makeLedgerHarness();
    const destHash = 'dest';
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-single',
        dirName: '001_single',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 1,
      },
    ];
    const planOps = serializedOperations([createCollection('ledger_single')]);
    const result = await runner.execute({
      plan: makeLedgerPlan([createCollection('ledger_single')], { destinationHash: destHash }),
      destinationContract: makeContract(destHash),
      policy: ALL_POLICY,
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: LEDGER_EXECUTION_CHECKS,
      migrationEdges: edges,
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 1,
      changedDatabase: true,
    });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toMatchObject({
      edgeId: `${EMPTY_CONTRACT_HASH}->${destHash}`,
      from: EMPTY_CONTRACT_HASH,
      to: destHash,
      migrationName: '001_single',
      migrationHash: 'mig-single',
    });
    const storedOps = ledgerEntries[0]?.operations as Array<{ id: string }>;
    expect(storedOps).toHaveLength(1);
    expect(storedOps[0]?.id).toBe((planOps[0] as { id: string }).id);
  });

  it('writes N ledger entries in walk order for multi-edge apply with ops attributed per edge', async () => {
    const { runner, ledgerEntries } = makeLedgerHarness();
    const hashA = 'ledger-mid-a';
    const hashB = 'ledger-mid-b';
    const destHash = 'dest';
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-a',
        dirName: '001_a',
        from: EMPTY_CONTRACT_HASH,
        to: hashA,
        operationCount: 1,
      },
      {
        migrationHash: 'mig-b',
        dirName: '002_b',
        from: hashA,
        to: hashB,
        operationCount: 2,
      },
      {
        migrationHash: 'mig-c',
        dirName: '003_c',
        from: hashB,
        to: destHash,
        operationCount: 1,
      },
    ];
    const ops = [
      createCollection('ledger_a'),
      createCollection('ledger_b1'),
      createCollection('ledger_b2'),
      createCollection('ledger_c'),
    ];
    const planOps = serializedOperations(ops) as Array<{ id: string }>;

    const result = await runner.execute({
      plan: makeLedgerPlan(ops, { destinationHash: destHash }),
      destinationContract: makeContract(destHash),
      policy: ALL_POLICY,
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: LEDGER_EXECUTION_CHECKS,
      migrationEdges: edges,
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 4,
      operationsExecuted: 4,
      changedDatabase: true,
    });
    expect(ledgerEntries).toHaveLength(3);
    expect(ledgerEntries.map((e) => e.migrationName)).toEqual(['001_a', '002_b', '003_c']);
    expect(ledgerEntries[0]).toMatchObject({
      edgeId: `${EMPTY_CONTRACT_HASH}->${hashA}`,
      from: EMPTY_CONTRACT_HASH,
      to: hashA,
      migrationHash: 'mig-a',
    });
    expect(ledgerEntries[1]).toMatchObject({
      edgeId: `${hashA}->${hashB}`,
      from: hashA,
      to: hashB,
      migrationHash: 'mig-b',
    });
    expect(ledgerEntries[2]).toMatchObject({
      edgeId: `${hashB}->${destHash}`,
      from: hashB,
      to: destHash,
      migrationHash: 'mig-c',
    });

    const opCounts = ledgerEntries.map((e) => (e.operations as unknown[]).length);
    expect(opCounts).toEqual([1, 2, 1]);
    const opIds = ledgerEntries.flatMap((e) =>
      (e.operations as Array<{ id: string }>).map((o) => o.id),
    );
    expect(opIds).toEqual(planOps.map((o) => o.id));
  });

  it('throws when migrationEdges operationCount sum does not match plan.operations length', async () => {
    const { runner } = makeLedgerHarness();
    const destHash = 'dest';
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'mig-single',
        dirName: '001_single',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 2,
      },
    ];

    await expect(
      runner.execute({
        plan: makeLedgerPlan([createCollection('ledger_single')], { destinationHash: destHash }),
        destinationContract: makeContract(destHash),
        policy: ALL_POLICY,
        frameworkComponents: [],
        strictVerification: false,
        executionChecks: LEDGER_EXECUTION_CHECKS,
        migrationEdges: edges,
      }),
    ).rejects.toThrow(/does not match sum of migrationEdges operationCount/);
  });

  it('writes one synthesised ledger entry with empty migration name for synth apply with a single synth edge', async () => {
    const { runner, ledgerEntries } = makeLedgerHarness();
    const destHash = 'dest';
    const plan = makeLedgerPlan([createCollection('ledger_synth')], { destinationHash: destHash });
    const synthEdges: readonly AggregateMigrationEdgeRef[] = [
      {
        dirName: '',
        migrationHash: destHash,
        from: '',
        to: destHash,
        operationCount: plan.operations.length,
      },
    ];

    const result = await runner.execute({
      plan,
      destinationContract: makeContract(destHash),
      policy: ALL_POLICY,
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: LEDGER_EXECUTION_CHECKS,
      migrationEdges: synthEdges,
    });

    expect(result.assertOk()).toEqual({
      operationsPlanned: 1,
      operationsExecuted: 1,
      changedDatabase: true,
    });
    expect(ledgerEntries).toHaveLength(1);
    expect(ledgerEntries[0]).toMatchObject({
      edgeId: `->${destHash}`,
      from: '',
      to: destHash,
      migrationName: '',
      migrationHash: destHash,
    });
    expect((ledgerEntries[0]!.operations as unknown[]).length).toBe(1);
  });
});

const COMMAND_ECHO =
  'not authorized on app to execute command { update: "users", ordered: true, bypassDocumentValidation: true, lsid: { id: UUID("0b2c8a4e-6f0d-4a7e-9d6f-2f1d5c3e8a91") }, txnNumber: 1, $clusterTime: { clusterTime: Timestamp(1791552000, 3), signature: { hash: BinData(0, 7F3C1D9E2A4B6C8D0E1F2A3B4C5D6E7F8A9B0C1D), keyId: 7421987654321098753 } }, $db: "app" }';

describe('MongoMigrationRunner, a document rewrite without the privilege to skip validation', () => {
  const unauthorized = () =>
    new MongoServerError({
      ok: 0,
      code: 13,
      codeName: 'Unauthorized',
      errmsg: COMMAND_ECHO,
    });

  it('names the bypassDocumentValidation action and the roles that grant it', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.failUpdateManyWith(unauthorized());

    const result = await execute(harness, [unsetField('users', 'nickname')]);

    expect(JSON.stringify(result.assertNotOk())).not.toContain('clusterTime');
    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.EXECUTION_FAILED',
      message:
        'Operation field.users.nickname.unset failed: the database user may not skip document validation',
      why: 'Rewriting or copying documents to fit the new schema skips document validation, because the old validator rejects the new shape. MongoDB refused it with error 13 (Unauthorized). Grant the user the bypassDocumentValidation action on the database, for example with the dbAdmin or restore role. Then run the command again; operations that already ran are skipped. The failed apply changed nothing.',
      meta: {
        operationId: 'field.users.nickname.unset',
        mongoCode: 13,
        codeName: 'Unauthorized',
        databaseUnchanged: true,
      },
    });
  });

  it('fails a rewrite that MongoDB stops partway on a duplicate key, naming the index to resolve', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.failUpdateManyWith(
      new MongoServerError({
        ok: 0,
        code: 11000,
        codeName: 'DuplicateKey',
        errmsg:
          'Plan executor error during update :: caused by :: E11000 duplicate key error collection: app.users index: code_1 dup key: { code: 1 }',
      }),
    );

    const result = await execute(harness, [
      castField({ collection: 'users', field: 'code', from: ['string'], to: 'int' }),
    ]);

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.EXECUTION_FAILED',
      message:
        'Operation field.users.code.cast(int) failed: MongoDB error 11000 (DuplicateKey): E11000 duplicate key error collection: app.users index: code_1 dup key: { code: 1 }',
      why: 'Documents the rewrite changed before the error stay changed. The rewrite would give two documents the same value under unique index "code_1". Change or remove the documents that would collide, then run the command again; operations that already ran are skipped. The operations that ran before the failure stay applied.',
      meta: {
        operationId: 'field.users.code.cast(int)',
        mongoCode: 11000,
        codeName: 'DuplicateKey',
        databaseUnchanged: false,
      },
    });
  });

  it('fails a rewrite that MongoDB stops partway for another reason, without claiming a re-run finishes it', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.failUpdateManyWith(
      new MongoServerError({
        ok: 0,
        code: 50,
        codeName: 'MaxTimeMSExpired',
        errmsg: 'operation exceeded time limit',
      }),
    );

    const result = await execute(harness, [
      castField({ collection: 'users', field: 'code', from: ['string'], to: 'int' }),
    ]);

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.EXECUTION_FAILED',
      message:
        'Operation field.users.code.cast(int) failed: MongoDB error 50 (MaxTimeMSExpired): operation exceeded time limit',
      why: 'Documents the rewrite changed before the error stay changed. The operations that ran before the failure stay applied.',
      meta: {
        operationId: 'field.users.code.cast(int)',
        mongoCode: 50,
        codeName: 'MaxTimeMSExpired',
        databaseUnchanged: false,
      },
    });
  });

  it('gives a data transform whose run skips validation the same advice', async () => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(unauthorized());

    const result = await execute(harness, [
      dataTransform('User.age', {
        run: () =>
          rawUpdateMany('users', { age: null }, [{ $set: { age: 0 } }], {
            bypassDocumentValidation: true,
          }),
      }),
    ]);

    expect(result.assertNotOk().message).toBe(
      'Operation data_transform.User.age failed: the database user may not skip document validation',
    );
  });

  it('gives a data transform whose copy skips validation the same advice', async () => {
    const harness = makeHarness();
    harness.driver.failAggregateWith(unauthorized());

    const result = await execute(harness, [
      dataTransform('move User to members', {
        run: () =>
          rawAggregate('users', [{ $match: { kind: 'user' } }, { $merge: { into: 'members' } }], {
            bypassDocumentValidation: true,
          }),
      }),
    ]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      message:
        'Operation data_transform.move User to members failed: the database user may not skip document validation',
      why: 'Rewriting or copying documents to fit the new schema skips document validation, because the old validator rejects the new shape. MongoDB refused it with error 13 (Unauthorized). Grant the user the bypassDocumentValidation action on the database, for example with the dbAdmin or restore role. Then run the command again; operations that already ran are skipped. The failed apply changed nothing.',
    });
  });

  it("names any other failure of a data transform's update, with the user's update as the place to fix it", async () => {
    const harness = makeHarness();
    harness.driver.failUpdateManyWith(unauthorized());

    const result = await execute(harness, [
      dataTransform('backfill-status', { run: () => makeRunPlan() }),
    ]);

    expect(failureFields(result.assertNotOk())).toMatchObject({
      code: 'MIGRATION.EXECUTION_FAILED',
      why: expect.stringContaining("change it in the migration's migration.ts"),
      meta: {
        operationId: 'data_transform.backfill-status',
        mongoCode: 13,
        codeName: 'Unauthorized',
      },
    });
  });
});

describe('MongoMigrationRunner, a field rename stopped because documents already hold the new name', () => {
  it('says which collection, how to find the documents, and that nothing changed when no operation ran before it', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: 1 }]);
    harness.driver.queueResponse([{ _id: 2 }]);

    const result = await execute(harness, [
      renameField('posts', 'title', 'headline', { filter: { type: 'bug' } }),
    ]);

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation field.posts.title.rename(headline).where({"type":"bug"}) stopped: some documents in collection posts already hold headline as well as title',
      why: 'Renaming title to headline would overwrite their headline. Find them with db.getCollection("posts").find({"$and":[{"type":"bug"},{"title":{"$exists":true}},{"headline":{"$exists":true}}]}) in mongosh, and move or remove one of the two values in each. Once the documents are fixed, run the command again; operations that already ran are skipped. The failed apply changed nothing.',
      meta: {
        databaseUnchanged: true,
        operationId: 'field.posts.title.rename(headline).where({"type":"bug"})',
        name: 'field.posts.title.rename(headline).where({"type":"bug"})',
      },
    });
  });
});

describe('MongoMigrationRunner, a collection rename stopped because the new collection exists', () => {
  it('says that the new collection exists, names both collections, and once that the failed apply changed nothing', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'events' }, { name: 'occasions' }];

    const result = await execute(harness, [renameCollection('events', 'occasions')]);

    expect(harness.ddlCalls).toEqual([]);
    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation collection.events.rename(occasions) stopped: collection occasions already exists, so collection events cannot be renamed to it',
      why: 'If occasions holds nothing you need, drop it, then run the command again; operations that already ran are skipped. If an earlier operation of the same migration created occasions, as a createIndex on occasions does, in its migration.ts put renameCollection("events", "occasions") right after the drops of indexes on "events", if there are any, and before every other operation, run node on that migration.ts, and then drop occasions and run the command again. If occasions is a temporary name that a refused rename suggested, you can instead delete this migration, give the model another temporary name that the database does not have, and plan again. The failed apply changed nothing.',
      meta: { operationId: 'collection.events.rename(occasions)', databaseUnchanged: true },
    });
  });
});

describe('MongoMigrationRunner, a DDL precheck that does not hold', () => {
  it('reports the failed check once, in meta.failedCheck', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.indexes = [{ name: 'email_1', key: { name: 1 } }];

    const result = await execute(
      harness,
      [createIndex('orders', [{ field: 'email', direction: 1 }], { name: 'email_1' })],
      { prechecks: true, postchecks: false, idempotencyChecks: false },
    );

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.PRECHECK_FAILED',
      message:
        'Operation index.orders.create(email_1) failed during precheck: no index named email_1 exists on orders',
      why: 'Before operation index.orders.create(email_1) runs, it checks: no index named email_1 exists on orders. That check failed: the database already has an index named "email_1" in "orders". The failed apply changed nothing.',
      meta: {
        databaseUnchanged: true,
        failedCheck: {
          operationId: 'index.orders.create(email_1)',
          phase: 'precheck',
          description: 'no index named email_1 exists on orders',
          expectation: { expects: 'absent', object: 'an index named "email_1" in "orders"' },
        },
      },
    });
  });
});

describe('MongoMigrationRunner, a DDL precheck that reads documents', () => {
  function validatorWithDocumentCheck(): AnyMongoMigrationOperation {
    return {
      id: 'validator.users.update',
      label: 'Update validator on users',
      operationClass: 'widening',
      precheck: [
        {
          description: 'no document in users matches',
          source: makeCheckPlan(),
          filter: MongoExistsExpr.exists('_id'),
          expect: 'notExists',
        },
      ],
      execute: [
        {
          description: 'update validator on users',
          command: new CollModCommand(RUN_COLLECTION, { validator: { $jsonSchema: {} } }),
        },
      ],
      postcheck: [],
    };
  }

  it('reads the documents through the adapter and the driver, and runs the operation when none match', async () => {
    const harness = makeHarness();

    const result = await execute(harness, [validatorWithDocumentCheck()]);

    expect(result.ok).toBe(true);
    expect(harness.log.entries).toEqual([
      `dml:aggregate:${RUN_COLLECTION}`,
      `ddl:collMod:${RUN_COLLECTION}`,
    ]);
    expect(harness.inspectionExecutor.calls).toEqual([]);
  });

  it('fails the precheck when a document matches, and runs nothing', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: 'u1' }]);

    const result = await execute(harness, [validatorWithDocumentCheck()]);

    expect(result.assertNotOk().code).toBe('MIGRATION.PRECHECK_FAILED');
    expect(harness.ddlCalls).toEqual([]);
  });

  it('rejects a document check that writes, in words for any migration check', async () => {
    const harness = makeHarness();
    const op = validatorWithDocumentCheck();

    await expect(
      execute(harness, [
        { ...op, precheck: [{ ...op.precheck[0]!, source: makeWriteCheckPlan() }] },
      ] as AnyMongoMigrationOperation[]),
    ).rejects.toMatchObject({
      code: 'MIGRATION.DATA_TRANSFORM_CHECK_NOT_READ_ONLY',
      message: 'Migration check rejected: command kind "rawUpdateMany" is not read-only',
      why: 'A migration check must read with an aggregate or rawAggregate command, so that running it cannot change the database.',
    });
  });

  it('gives the plain precheck failure when the documents were fixed before they were counted', async () => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: 'u1' }]);
    harness.driver.queueResponse([]);

    const result = await execute(harness, [validatorWithDocumentCheck()]);

    expect(result.assertNotOk().message).toBe(
      'Operation validator.users.update failed during precheck: no document in users matches',
    );
  });

  it.each([
    [new Date('2024-05-01T10:00:00.000Z'), 'ISODate("2024-05-01T10:00:00.000Z")'],
    [
      new UUID('3f2a8c1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b'),
      'UUID("3f2a8c1e-4b5d-4e6f-8a9b-0c1d2e3f4a5b")',
    ],
    [new ObjectId('64b7f0c2a1b2c3d4e5f60718'), 'ObjectId("64b7f0c2a1b2c3d4e5f60718")'],
    ['ada', '"ada"'],
    [42, '42'],
  ])('writes the _id %s as mongosh does', async (documentId, written) => {
    const harness = makeHarness();
    harness.driver.queueResponse([{ _id: documentId }]);
    harness.driver.queueResponse([{ _id: null, documents: 1, documentId }]);

    const result = await execute(harness, [validatorWithDocumentCheck()]);

    expect(result.assertNotOk().meta['documentsFailingValidator']).toMatchObject({
      documentId: written,
    });
  });
});

describe('MongoMigrationRunner, a DDL postcheck that does not hold', () => {
  it('reports the failed check in meta.failedCheck, with what it expected', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.collections = [{ name: 'events' }];

    const result = await execute(harness, [renameCollection('events', 'occasions')], {
      prechecks: true,
      postchecks: true,
      idempotencyChecks: false,
    });

    expect(failureFields(result.assertNotOk())).toEqual({
      code: 'MIGRATION.POSTCHECK_FAILED',
      message:
        'Operation collection.events.rename(occasions) failed during postcheck: collection occasions exists',
      why: 'After operation collection.events.rename(occasions) ran, it checks: collection occasions exists. That check failed: the database has no collection "occasions". The operations that ran before the failure stay applied.',
      meta: {
        databaseUnchanged: false,
        operationId: 'collection.events.rename(occasions)',
        failedCheck: {
          operationId: 'collection.events.rename(occasions)',
          phase: 'postcheck',
          description: 'collection occasions exists',
          expectation: { expects: 'present', object: 'collection "occasions"' },
        },
      },
    });
  });
});

describe('MongoMigrationRunner, a failure after an earlier space changed the database', () => {
  it('says the operations that ran stay applied, though this space changed nothing', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.indexes = [{ name: 'email_1', key: { name: 1 } }];
    const plan = makePlan([
      createIndex('orders', [{ field: 'email', direction: 1 }], { name: 'email_1' }),
    ]);

    const result = await harness.runner.execute({
      plan,
      migrationEdges: synthEdges(plan),
      destinationContract: makeContract('dest'),
      policy: ALL_POLICY,
      frameworkComponents: [],
      executionChecks: { prechecks: true, postchecks: false, idempotencyChecks: false },
      databaseChangedBefore: true,
    });

    const failure = result.assertNotOk();
    expect({
      databaseUnchanged: failure.meta.databaseUnchanged,
      why: failure.why,
    }).toEqual({
      databaseUnchanged: false,
      why: 'Before operation index.orders.create(email_1) runs, it checks: no index named email_1 exists on orders. That check failed: the database already has an index named "email_1" in "orders". The operations that ran before the failure stay applied.',
    });
  });
});

describe('MongoMigrationRunner, an index check that finds an index of the same keys', () => {
  it('names the keys it matched when another index holds the same keys and options', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.indexes = [{ name: 'by_email', key: { email: 1 } }];

    const result = await execute(
      harness,
      [createIndex('users', [{ field: 'email', direction: 1 }])],
      {
        prechecks: true,
        postchecks: false,
        idempotencyChecks: false,
      },
    );

    expect(result.assertNotOk().why).toBe(
      'Before operation index.users.create(email_1) runs, it checks: no index with the same keys and options exists on users. That check failed: the database already has an index on { email: 1 } in "users". The failed apply changed nothing.',
    );
  });

  it('names the index name it matched when another index holds the name', async () => {
    const harness = makeHarness();
    harness.inspectionExecutor.indexes = [{ name: 'email_1', key: { name: 1 } }];

    const result = await execute(
      harness,
      [createIndex('users', [{ field: 'email', direction: 1 }], { name: 'email_1' })],
      {
        prechecks: true,
        postchecks: false,
        idempotencyChecks: false,
      },
    );

    expect(result.assertNotOk().why).toBe(
      'Before operation index.users.create(email_1) runs, it checks: no index named email_1 exists on users. That check failed: the database already has an index named "email_1" in "users". The failed apply changed nothing.',
    );
  });
});

describe('MongoMigrationRunner, a DDL command that fails for a reason other than a unique index build', () => {
  it('surfaces its own error without reading the collection', async () => {
    const ddlError = new Error('collection create refused');
    const inspectionExecutor = new StubInspectionExecutor();
    inspectionExecutor.listCollections = async () => {
      throw new Error('listCollections failed');
    };
    const runner = new MongoMigrationRunner({
      inspectionExecutor,
      adapter: new StubMongoAdapter(),
      driver: new StubMongoDriver(),
      executeDdl: async () => {
        throw ddlError;
      },
      markerOps: NOOP_MARKER_OPS,
      introspectSchema: async () => new MongoSchemaIR([], { fromDatabase: false }),
    });
    const plan = makePlan([createCollection('orders')]);

    await expect(
      runner.execute({
        plan,
        migrationEdges: synthEdges(plan),
        destinationContract: makeContract('dest'),
        policy: ALL_POLICY,
        frameworkComponents: [],
        executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
      }),
    ).rejects.toBe(ddlError);
  });
});
