import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { CheckConstraint, SqlStorage } from '@internal/sql-contract/types';
import { composeCheckWirePrefix, computeCheckContentHash } from '@internal/sql-schema-ir/naming';

import { parsePostgresListText } from '@internal/target-postgres/control';
import {
  postgresCreateNamespace,
  postgresRenderCheckExpressions,
} from '@internal/target-postgres/types';
import { applicationDomainOf } from '@repo/test-utils';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  controlAdapter,
  createDriver,
  createTestDatabase,
  emptySchema,
  familyInstance,
  formatRunnerFailure,
  frameworkComponents,
  type PostgresControlDriver,
  postgresTargetDescriptor,
  resetDatabase,
  synthEdges,
  testTimeout,
} from './fixtures/runner-fixtures';

const ARRAY_COLUMNS = ['tags', 'labels', 'scores', 'tagsWithDefault'] as const;

/**
 * The element-non-null checks exactly as authoring emits them: the Postgres
 * pack renders the predicate, and the wire name is the prefix plus the
 * predicate's content hash. The planner installs whatever the contract
 * declares and synthesizes nothing, so a contract that wants these checks has
 * to carry them.
 */
function declaredArrayElementChecks(): CheckConstraint[] {
  return ARRAY_COLUMNS.flatMap((columnName) =>
    postgresRenderCheckExpressions({
      tableName: 'ArrayTest',
      columnName,
      many: true,
      memberValues: undefined,
    }).map(
      (candidate) =>
        new CheckConstraint({
          naming: {
            kind: 'wire',
            prefix: composeCheckWirePrefix('ArrayTest', candidate.columnName, candidate.kind),
            hash: computeCheckContentHash(candidate.expression),
          },
          expression: candidate.expression,
        }),
    ),
  );
}

function buildArrayContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('native-array-columns'),
    storage: new SqlStorage({
      storageHash: coreHash('native-array-columns'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: postgresCreateNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              ArrayTest: {
                columns: {
                  id: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false },
                  tags: { nativeType: 'text', codecId: 'pg/text@1', nullable: false, many: true },
                  labels: { nativeType: 'text', codecId: 'pg/text@1', nullable: true, many: true },
                  scores: { nativeType: 'int4', codecId: 'pg/int4@1', nullable: false, many: true },
                  tagsWithDefault: {
                    nativeType: 'text',
                    codecId: 'pg/text@1',
                    nullable: false,
                    many: true,
                    default: { kind: 'literal' as const, value: [] },
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
                checks: declaredArrayElementChecks(),
              },
            },
          },
        }),
      },
    }),
    roots: {},
    domain: applicationDomainOf({ models: {} }),
    capabilities: {},
    extensions: {},
    meta: {},
  };
}

describe('native array columns DDL', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;

  beforeAll(async () => {
    database = await createTestDatabase();
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it('migrates many:true columns to native Postgres array types', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildArrayContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    expect(planResult.kind).toBe('success');
    if (planResult.kind !== 'success') throw new Error('planner failed');

    const runResult = await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });
    if (!runResult.ok) {
      throw new Error(`runner failed:\n${formatRunnerFailure(runResult.failure)}`);
    }

    const colTypes = await driver!.query<{ column_name: string; data_type: string }>(
      `SELECT column_name, data_type
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ArrayTest'
           ORDER BY ordinal_position`,
    );
    const typeMap = Object.fromEntries(colTypes.rows.map((r) => [r.column_name, r.data_type]));
    expect(typeMap['tags']).toBe('ARRAY');
    expect(typeMap['labels']).toBe('ARRAY');
    expect(typeMap['scores']).toBe('ARRAY');
    expect(typeMap['tagsWithDefault']).toBe('ARRAY');
  });

  it('emits text[] and int4[] element types from format_type', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildArrayContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') throw new Error('planner failed');

    await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    const colFormats = await driver!.query<{ attname: string; formatted_type: string }>(
      `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS formatted_type
           FROM pg_catalog.pg_attribute a
           JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
           WHERE n.nspname = 'public' AND c.relname = 'ArrayTest'
             AND a.attnum > 0 AND NOT a.attisdropped
           ORDER BY a.attnum`,
    );
    const fmtMap = Object.fromEntries(colFormats.rows.map((r) => [r.attname, r.formatted_type]));
    expect(fmtMap['tags']).toBe('text[]');
    expect(fmtMap['scores']).toBe('integer[]');
  });

  it('container nullability: NOT NULL for nullable:false, nullable for nullable:true', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildArrayContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') throw new Error('planner failed');

    await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    const nullabilityRows = await driver!.query<{
      column_name: string;
      is_nullable: string;
    }>(
      `SELECT column_name, is_nullable
           FROM information_schema.columns
           WHERE table_schema = 'public' AND table_name = 'ArrayTest'
           ORDER BY ordinal_position`,
    );
    const nullMap = Object.fromEntries(
      nullabilityRows.rows.map((r) => [r.column_name, r.is_nullable]),
    );
    expect(nullMap['tags']).toBe('NO');
    expect(nullMap['labels']).toBe('YES');
    expect(nullMap['scores']).toBe('NO');
  });

  it('empty-list default yields [] on insert omitting the column', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildArrayContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') throw new Error('planner failed');

    await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    await driver!.query(
      `INSERT INTO "ArrayTest" (id, tags, scores) VALUES (1, ARRAY[]::text[], ARRAY[]::integer[])`,
    );

    const rows = await driver!.query<{ tags_default: unknown }>(
      `SELECT "tagsWithDefault" AS tags_default FROM "ArrayTest" WHERE id = 1`,
    );
    expect(parsePostgresListText(rows.rows[0]?.tags_default)).toEqual([]);
  });

  it('emits a non-null-element CHECK constraint on every array column', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildArrayContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') throw new Error('planner failed');

    await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    const checkRows = await driver!.query<{ constraint_name: string; constraintdef: string }>(
      `SELECT c.conname AS constraint_name, pg_get_constraintdef(c.oid) AS constraintdef
           FROM pg_catalog.pg_constraint c
           JOIN pg_catalog.pg_class t ON t.oid = c.conrelid
           JOIN pg_catalog.pg_namespace n ON n.oid = t.relnamespace
           WHERE n.nspname = 'public' AND t.relname = 'ArrayTest' AND c.contype = 'c'
           ORDER BY c.conname`,
    );
    const checkNames = checkRows.rows.map((r) => r.constraint_name).sort();
    // Wire names: the declared prefix plus the content hash of the predicate.
    expect(checkNames).toEqual(
      declaredArrayElementChecks()
        .map((c) => c.name)
        .sort(),
    );
    expect(checkRows.rows.every((r) => /array_position/i.test(r.constraintdef))).toBe(true);
  });

  it('rejects an INSERT carrying a NULL array element', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildArrayContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') throw new Error('planner failed');

    await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    await expect(
      driver!.query(
        `INSERT INTO "ArrayTest" (id, tags, scores) VALUES (1, ARRAY['a', NULL, 'c']::text[], ARRAY[]::integer[])`,
      ),
    ).rejects.toThrow();
  });

  it('schema verification passes after migrating array columns', {
    timeout: testTimeout,
  }, async () => {
    const contract = buildArrayContract();
    const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
    const runner = postgresTargetDescriptor.createRunner(familyInstance);

    const planResult = planner.plan({
      contract,
      schema: emptySchema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') throw new Error('planner failed');

    await runner.execute({
      driver: driver!,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: synthEdges(planResult.plan),
          driver: driver!,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents,
        },
      ],
    });

    const schema = await familyInstance.introspect({ driver: driver!, contract });
    const verifyResult = familyInstance.verifySchema({
      contract,
      schema,
      strict: false,
      frameworkComponents,
    });
    expect(verifyResult.ok).toBe(true);
    if (!verifyResult.ok) {
      throw new Error(
        `verifySchema failed: ${JSON.stringify(verifyResult.schema.issues, null, 2)}`,
      );
    }
  });
});
