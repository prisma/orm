import { MongoControlAdapterImpl } from '@internal/adapter-mongo/control';
import {
  createPostgresBuiltinCodecLookup,
  PostgresControlAdapter,
} from '@internal/adapter-postgres/control';
import {
  createSqliteBuiltinCodecLookup,
  SqliteControlAdapter,
} from '@internal/adapter-sqlite/control';
import { MongoControlDriver } from '@internal/driver-mongo/control';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import {
  type AggregateMigrationEdgeRef,
  buildFabricatedMigrationEdge,
} from '@internal/migration-tools/aggregate';
import { EMPTY_CONTRACT_HASH } from '@internal/migration-tools/constants';
import type { MongoContract } from '@internal/mongo-contract';
import { MongoMigrationRunner, serializeMongoOps } from '@internal/target-mongo/control';
import { createCollection, createIndex } from '@internal/target-mongo/migration';
import type { PostgresPlanTargetDetails } from '@internal/target-postgres/planner-target-details';
import { timeouts } from '@repo/test-utils';
import { type Db, MongoClient } from 'mongodb';
import { MongoMemoryReplSet } from 'mongodb-memory-server';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  assertOperationCountsMatchAcrossBackends,
  buildMultiEdgeRefs,
  ledgerOperationCounts,
  MULTI_EDGE_OPERATION_COUNTS,
} from '../../../../packages/1-framework/3-tooling/migration/test/fixtures/ledger-operation-count-parity';
import {
  createDriver,
  createLedgerTestPlan,
  createTestDatabase as createPgTestDatabase,
  formatRunnerFailure,
  LEDGER_TEST_SPACE_ID,
  contract as pgContract,
  familyInstance as pgFamily,
  frameworkComponents as pgFrameworkComponents,
  postgresTargetDescriptor,
  resetDatabase,
} from '../../../../packages/3-targets/6-adapters/postgres/test/migrations/fixtures/runner-fixtures';
import {
  createLedgerTestPlan as createSqliteLedgerPlan,
  createTestDatabase as createSqliteTestDatabase,
  contract as sqliteContract,
  familyInstance as sqliteFamily,
  frameworkComponents as sqliteFrameworkComponents,
  sqliteTargetDescriptor,
} from '../../../../packages/3-targets/6-adapters/sqlite/test/migrations/fixtures/runner-fixtures';

const controlAdapter = new MongoControlAdapterImpl();

function multiEdgePlanPg() {
  const destHash = pgContract.storage.storageHash;
  const edges = buildMultiEdgeRefs(destHash);
  const plan = createLedgerTestPlan<PostgresPlanTargetDetails>({
    destinationHash: destHash,
    operations: [
      {
        id: 'edge.a',
        label: 'a',
        operationClass: 'additive',
        target: { id: 'postgres', details: { schema: 'public', objectType: 'table', name: 'a' } },
        precheck: [],
        execute: [],
        postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
      },
      {
        id: 'edge.b1',
        label: 'b1',
        operationClass: 'additive',
        target: { id: 'postgres', details: { schema: 'public', objectType: 'table', name: 'b1' } },
        precheck: [],
        execute: [],
        postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
      },
      {
        id: 'edge.b2',
        label: 'b2',
        operationClass: 'additive',
        target: { id: 'postgres', details: { schema: 'public', objectType: 'table', name: 'b2' } },
        precheck: [],
        execute: [],
        postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
      },
      {
        id: 'edge.c',
        label: 'c',
        operationClass: 'additive',
        target: { id: 'postgres', details: { schema: 'public', objectType: 'table', name: 'c' } },
        precheck: [],
        execute: [],
        postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
      },
    ],
    migrationEdges: edges,
  });
  return { destHash, edges, plan };
}

function multiEdgePlanSqlite() {
  const destHash = sqliteContract.storage.storageHash;
  const edges = buildMultiEdgeRefs(destHash);
  const plan = createSqliteLedgerPlan({
    destinationHash: destHash,
    operations: [
      {
        id: 'edge.a',
        label: 'a',
        operationClass: 'additive',
        target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'a' } },
        precheck: [],
        execute: [],
        postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
      },
      {
        id: 'edge.b1',
        label: 'b1',
        operationClass: 'additive',
        target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'b1' } },
        precheck: [],
        execute: [],
        postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
      },
      {
        id: 'edge.b2',
        label: 'b2',
        operationClass: 'additive',
        target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'b2' } },
        precheck: [],
        execute: [],
        postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
      },
      {
        id: 'edge.c',
        label: 'c',
        operationClass: 'additive',
        target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'c' } },
        precheck: [],
        execute: [],
        postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
      },
    ],
    migrationEdges: edges,
  });
  return { destHash, edges, plan };
}

function bareMongoContract(storageHash: string): MongoContract {
  return {
    storage: {
      storageHash,
      namespaces: {
        __unbound__: {
          id: '__unbound__',
          kind: 'mongo-namespace',
          entries: { collection: {} },
        },
      },
    },
  } as unknown as MongoContract;
}

describe('LedgerEntryRecord.operationCount parity across targets', {
  concurrent: false,
  timeout: timeouts.spinUpMongoMemoryServer,
}, () => {
  let pgDatabase: Awaited<ReturnType<typeof createPgTestDatabase>>;
  let pgDriver: Awaited<ReturnType<typeof createDriver>> | undefined;
  let sqliteTestDb: ReturnType<typeof createSqliteTestDatabase> | undefined;
  let mongoReplSet: MongoMemoryReplSet;
  let mongoClient: MongoClient;
  let mongoDb: Db;

  beforeAll(async () => {
    pgDatabase = await createPgTestDatabase();
    mongoReplSet = await MongoMemoryReplSet.create({
      replSet: { count: 1, storageEngine: 'wiredTiger' },
    });
    mongoClient = new MongoClient(mongoReplSet.getUri());
    await mongoClient.connect();
    mongoDb = mongoClient.db('ledger_op_count_parity');
  }, timeouts.spinUpMongoMemoryServer);

  afterAll(async () => {
    await pgDriver?.close();
    await pgDatabase?.close();
    sqliteTestDb?.cleanup();
    await mongoClient?.close();
    await mongoReplSet?.stop();
  }, timeouts.spinUpMongoMemoryServer);

  beforeEach(async () => {
    pgDriver = await createDriver(pgDatabase.connectionString);
    await resetDatabase(pgDriver);
    sqliteTestDb = createSqliteTestDatabase();
    const collections = await mongoDb.listCollections().toArray();
    for (const col of collections) {
      await mongoDb.dropCollection(col['name'] as string);
    }
  }, timeouts.databaseOperation);

  afterEach(async () => {
    await pgDriver?.close();
    pgDriver = undefined;
    sqliteTestDb?.cleanup();
    sqliteTestDb = undefined;
  }, timeouts.databaseOperation);

  it('matches per-edge operationCount for multi-edge graph-walk apply', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const pg = multiEdgePlanPg();
    const pgRunner = postgresTargetDescriptor.createRunner(pgFamily);
    const pgResult = await pgRunner.execute({
      driver: pgDriver!,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan: pg.plan,
          driver: pgDriver!,
          destinationContract: pgContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: pgFrameworkComponents,
          strictVerification: false,
          migrationEdges: pg.edges,
        },
      ],
    });
    if (!pgResult.ok) throw new Error(formatRunnerFailure(pgResult.failure));
    const pgLedger = await new PostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
    ).readLedger(pgDriver!, LEDGER_TEST_SPACE_ID);

    const sqlite = multiEdgePlanSqlite();
    const sqliteRunner = sqliteTargetDescriptor.createRunner(sqliteFamily);
    const sqliteDriver = sqliteTestDb!.driver;
    const sqliteResult = await sqliteRunner.execute({
      driver: sqliteDriver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan: sqlite.plan,
          driver: sqliteDriver,
          destinationContract: sqliteContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: sqliteFrameworkComponents,
          strictVerification: false,
          migrationEdges: sqlite.edges,
        },
      ],
    });
    if (!sqliteResult.ok) throw new Error(formatRunnerFailure(sqliteResult.failure));
    const sqliteLedger = await new SqliteControlAdapter(
      createSqliteBuiltinCodecLookup(),
    ).readLedger(sqliteDriver, LEDGER_TEST_SPACE_ID);

    const mongoDest = 'parity-mongo-multi';
    const mongoEdges = buildMultiEdgeRefs(mongoDest);
    const mongoPlan = {
      targetId: 'mongo' as const,
      spaceId: LEDGER_TEST_SPACE_ID,
      origin: null,
      destination: { storageHash: mongoDest },
      operations: JSON.parse(
        serializeMongoOps([
          createCollection('parity_a'),
          createCollection('parity_b1'),
          createCollection('parity_b2'),
          createCollection('parity_c'),
        ]),
      ),
    };
    const mongoRunner = new MongoMigrationRunner(
      controlAdapter.createRunnerDependencies(new MongoControlDriver(mongoDb, mongoClient)),
    );
    const mongoResult = await mongoRunner.execute({
      plan: mongoPlan,
      destinationContract: bareMongoContract(mongoDest),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
      strictVerification: false,
      executionChecks: { prechecks: false, postchecks: false, idempotencyChecks: false },
      migrationEdges: mongoEdges,
    });
    if (!mongoResult.ok) throw new Error(formatRunnerFailure(mongoResult.failure));
    const mongoLedger = await controlAdapter.readLedger(
      new MongoControlDriver(mongoDb, mongoClient),
      LEDGER_TEST_SPACE_ID,
    );

    const countsByBackend = {
      postgres: ledgerOperationCounts(pgLedger),
      sqlite: ledgerOperationCounts(sqliteLedger),
      mongo: ledgerOperationCounts(mongoLedger),
    };
    assertOperationCountsMatchAcrossBackends(countsByBackend);
    expect(countsByBackend.postgres).toEqual([...MULTI_EDGE_OPERATION_COUNTS]);
  });

  it('matches per-edge operationCount when an op is idempotency-skipped', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    await pgDriver!.query(
      'create table "user" (id uuid primary key, email text not null, constraint "user_email_unique" unique (email))',
    );
    await pgDriver!.query('create index "user_email_idx" on "user"(email)');
    const destHash = pgContract.storage.storageHash;
    const edges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'parity-skip',
        dirName: '001_skip',
        from: EMPTY_CONTRACT_HASH,
        to: destHash,
        operationCount: 1,
      },
    ];
    const plan = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: destHash,
      operations: [
        {
          id: 'table.user',
          label: 'Create user table',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'user' },
          },
          precheck: [{ description: 'would fail', sql: 'select false' }],
          execute: [{ description: 'would fail', sql: 'select 1/0' }],
          postcheck: [
            {
              description: 'user table exists',
              sql: `select to_regclass('public."user"') is not null`,
            },
          ],
        },
      ],
      migrationEdges: edges,
    });
    const pgRunner = postgresTargetDescriptor.createRunner(pgFamily);
    const pgResult = await pgRunner.execute({
      driver: pgDriver!,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan,
          driver: pgDriver!,
          destinationContract: pgContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: pgFrameworkComponents,
          strictVerification: false,
          migrationEdges: edges,
        },
      ],
    });
    if (!pgResult.ok) throw new Error(formatRunnerFailure(pgResult.failure));
    const pgLedger = await new PostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
    ).readLedger(pgDriver!, LEDGER_TEST_SPACE_ID);

    const sqliteDriver = sqliteTestDb!.driver;
    await sqliteDriver.query(
      'CREATE TABLE user (id INTEGER PRIMARY KEY, email TEXT NOT NULL UNIQUE)',
    );
    await sqliteDriver.query('CREATE INDEX user_email_idx ON user(email)');
    const sqliteDest = sqliteContract.storage.storageHash;
    const sqliteEdges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'parity-skip',
        dirName: '001_skip',
        from: EMPTY_CONTRACT_HASH,
        to: sqliteDest,
        operationCount: 1,
      },
    ];
    const sqlitePlan = createSqliteLedgerPlan({
      destinationHash: sqliteDest,
      operations: [
        {
          id: 'table.user',
          label: 'Create user table',
          operationClass: 'additive',
          target: { id: 'sqlite', details: { schema: 'main', objectType: 'table', name: 'user' } },
          precheck: [{ description: 'would fail', sql: 'SELECT 0' }],
          execute: [{ description: 'would fail', sql: 'SELECT 1/0' }],
          postcheck: [
            {
              description: 'user exists',
              sql: "SELECT name FROM sqlite_master WHERE type = 'table' AND name = 'user'",
            },
          ],
        },
      ],
      migrationEdges: sqliteEdges,
    });
    const sqliteRunner = sqliteTargetDescriptor.createRunner(sqliteFamily);
    const sqliteResult = await sqliteRunner.execute({
      driver: sqliteDriver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan: sqlitePlan,
          driver: sqliteDriver,
          destinationContract: sqliteContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: sqliteFrameworkComponents,
          strictVerification: false,
          migrationEdges: sqliteEdges,
        },
      ],
    });
    if (!sqliteResult.ok) throw new Error(formatRunnerFailure(sqliteResult.failure));
    const sqliteLedger = await new SqliteControlAdapter(
      createSqliteBuiltinCodecLookup(),
    ).readLedger(sqliteDriver, LEDGER_TEST_SPACE_ID);

    const mongoDest = 'parity-mongo-skip';
    const collection = 'parity_skip_user';
    await mongoDb.createCollection(collection);
    await mongoDb.collection(collection).createIndex({ email: 1 }, { name: 'email_1' });
    const mongoEdges: readonly AggregateMigrationEdgeRef[] = [
      {
        migrationHash: 'parity-skip',
        dirName: '001_skip',
        from: EMPTY_CONTRACT_HASH,
        to: mongoDest,
        operationCount: 1,
      },
    ];
    const mongoPlan = {
      targetId: 'mongo' as const,
      spaceId: LEDGER_TEST_SPACE_ID,
      origin: null,
      destination: { storageHash: mongoDest },
      operations: JSON.parse(
        serializeMongoOps([createIndex(collection, [{ field: 'email', direction: 1 }])]),
      ),
    };
    const mongoRunner = new MongoMigrationRunner(
      controlAdapter.createRunnerDependencies(new MongoControlDriver(mongoDb, mongoClient)),
    );
    const mongoResult = await mongoRunner.execute({
      plan: mongoPlan,
      destinationContract: bareMongoContract(mongoDest),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
      strictVerification: false,
      migrationEdges: mongoEdges,
    });
    if (!mongoResult.ok) throw new Error(formatRunnerFailure(mongoResult.failure));
    const mongoLedger = await controlAdapter.readLedger(
      new MongoControlDriver(mongoDb, mongoClient),
      LEDGER_TEST_SPACE_ID,
    );

    const countsByBackend = {
      postgres: ledgerOperationCounts(pgLedger),
      sqlite: ledgerOperationCounts(sqliteLedger),
      mongo: ledgerOperationCounts(mongoLedger),
    };
    assertOperationCountsMatchAcrossBackends(countsByBackend);
    expect(countsByBackend.postgres).toEqual([1]);
  });

  it('matches per-edge operationCount for greenfield family-sql synth apply', {
    timeout: timeouts.databaseOperation,
  }, async () => {
    const pgDest = pgContract.storage.storageHash;
    const pgSynthEdges = [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: null,
        destinationStorageHash: pgDest,
        operationCount: 1,
      }),
    ];
    const pgPlan = createLedgerTestPlan<PostgresPlanTargetDetails>({
      destinationHash: pgDest,
      operations: [
        {
          id: 'synth.greenfield',
          label: 'greenfield',
          operationClass: 'additive',
          target: {
            id: 'postgres',
            details: { schema: 'public', objectType: 'table', name: 'parity_synth' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT TRUE' }],
        },
      ],
      migrationEdges: pgSynthEdges,
    });
    const pgRunner = postgresTargetDescriptor.createRunner(pgFamily);
    const pgResult = await pgRunner.execute({
      driver: pgDriver!,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan: pgPlan,
          driver: pgDriver!,
          destinationContract: pgContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: pgFrameworkComponents,
          strictVerification: false,
          migrationEdges: pgSynthEdges,
        },
      ],
    });
    if (!pgResult.ok) throw new Error(formatRunnerFailure(pgResult.failure));
    const pgLedger = await new PostgresControlAdapter(
      createPostgresBuiltinCodecLookup(),
    ).readLedger(pgDriver!, LEDGER_TEST_SPACE_ID);

    const sqliteDest = sqliteContract.storage.storageHash;
    const sqliteSynthEdges = [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: null,
        destinationStorageHash: sqliteDest,
        operationCount: 1,
      }),
    ];
    const sqlitePlan = createSqliteLedgerPlan({
      destinationHash: sqliteDest,
      operations: [
        {
          id: 'synth.greenfield',
          label: 'greenfield',
          operationClass: 'additive',
          target: {
            id: 'sqlite',
            details: { schema: 'main', objectType: 'table', name: 'parity_synth' },
          },
          precheck: [],
          execute: [],
          postcheck: [{ description: 'ok', sql: 'SELECT 1' }],
        },
      ],
      migrationEdges: sqliteSynthEdges,
    });
    const sqliteDriver = sqliteTestDb!.driver;
    const sqliteRunner = sqliteTargetDescriptor.createRunner(sqliteFamily);
    const sqliteResult = await sqliteRunner.execute({
      driver: sqliteDriver,
      perSpaceOptions: [
        {
          space: LEDGER_TEST_SPACE_ID,
          plan: sqlitePlan,
          driver: sqliteDriver,
          destinationContract: sqliteContract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: sqliteFrameworkComponents,
          strictVerification: false,
          migrationEdges: sqliteSynthEdges,
        },
      ],
    });
    if (!sqliteResult.ok) throw new Error(formatRunnerFailure(sqliteResult.failure));
    const sqliteLedger = await new SqliteControlAdapter(
      createSqliteBuiltinCodecLookup(),
    ).readLedger(sqliteDriver, LEDGER_TEST_SPACE_ID);

    const mongoDest = 'parity-mongo-synth';
    const mongoPlan = {
      targetId: 'mongo' as const,
      spaceId: LEDGER_TEST_SPACE_ID,
      origin: null,
      destination: { storageHash: mongoDest },
      operations: JSON.parse(serializeMongoOps([createCollection('parity_synth')])),
    };
    const mongoSynthEdges = [
      buildFabricatedMigrationEdge({
        currentMarkerStorageHash: null,
        destinationStorageHash: mongoDest,
        operationCount: mongoPlan.operations.length,
      }),
    ];
    const mongoRunner = new MongoMigrationRunner(
      controlAdapter.createRunnerDependencies(new MongoControlDriver(mongoDb, mongoClient)),
    );
    const mongoResult = await mongoRunner.execute({
      plan: mongoPlan,
      destinationContract: bareMongoContract(mongoDest),
      policy: { allowedOperationClasses: ['additive', 'widening', 'destructive'] },
      frameworkComponents: [],
      strictVerification: false,
      migrationEdges: mongoSynthEdges,
    });
    if (!mongoResult.ok) throw new Error(formatRunnerFailure(mongoResult.failure));
    const mongoLedger = await controlAdapter.readLedger(
      new MongoControlDriver(mongoDb, mongoClient),
      LEDGER_TEST_SPACE_ID,
    );

    const countsByBackend = {
      postgres: ledgerOperationCounts(pgLedger),
      sqlite: ledgerOperationCounts(sqliteLedger),
      mongo: ledgerOperationCounts(mongoLedger),
      'sql-synth': [pgSynthEdges[0]!.operationCount],
    };
    assertOperationCountsMatchAcrossBackends(countsByBackend);
    expect(countsByBackend.postgres).toEqual([1]);
  });
});
