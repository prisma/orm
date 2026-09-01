/**
 * Reproduction for https://github.com/prisma/orm/issues/30163:
 * `ORDER BY` on a `pg.enum(...)` column backed by a real Postgres native enum
 * type renders `array_position(ARRAY[...]::text[], "col")` with no cast on
 * the column argument. Against a native enum column Postgres rejects this
 * with 42883 (`function array_position(text[], <enum>) does not exist`),
 * because the array is `text[]` but the column is not `text`.
 *
 * This exercises the full `pg.enum(Ref)` production path: PSL interpretation
 * (codecId `pg/enum@1`, physical native enum type), migration planning +
 * apply against a live database (real `CREATE TYPE ... AS ENUM`), then
 * lowering and executing an `ORDER BY` / `DISTINCT ON` query through the same
 * SQL renderer `db.orm` / `db.sql` use.
 */
import type { Contract, ControlPolicy } from '@internal/contract/types';
import { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { collectScalarTypeConstructors } from '@internal/framework-components/authoring';
import {
  APP_SPACE_ID,
  assembleAuthoringContributions,
} from '@internal/framework-components/control';
import { buildSymbolTable } from '@internal/psl-parser';
import { parse } from '@internal/psl-parser/syntax';
import type { SqlStorage } from '@internal/sql-contract/types';
import { interpretPslDocumentToSqlContract } from '@internal/sql-contract-psl';
import {
  ColumnRef,
  IdentifierRef,
  OrderByItem,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { ifDefined } from '@internal/utils/defined';
import { afterAll, afterEach, beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { createPostgresAdapter } from '../../src/core/adapter';
import { createPostgresBuiltinCodecLookup } from '../../src/core/codec-lookup';
import { postgresScalarAuthoringTypes } from '../../src/core/control-mutation-defaults';
import type { PostgresContract } from '../../src/core/types';
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

// Declaration order: open, closed. Alphabetical order would put closed first,
// so a correct declaration-order sort is distinguishable from a broken one.
// Nullable so the NULL-handling case below can exercise a real NULL row.
const PSL_WITH_NATIVE_ENUM = `
namespace public {
  native_enum Status {
    open   = "open"
    closed = "closed"
    @@map("ticket_status")
  }

  model tickets {
    id     Int @id
    status pg.enum(Status)?
  }
}
`;

function buildScalarTypeDescriptors(): ReadonlyMap<
  string,
  { codecId: string; nativeType: string }
> {
  return collectScalarTypeConstructors(postgresScalarAuthoringTypes);
}

function buildContractFromPsl(psl: string, control: ControlPolicy): PostgresContract {
  const assembled = assembleAuthoringContributions([postgresTargetDescriptor]);
  const scalarTypeDescriptors = buildScalarTypeDescriptors();

  const { document, sourceFile } = parse(psl);
  const { table: symbolTable } = buildSymbolTable({
    document,
    sourceFile,
    pslBlockDescriptors: assembled.pslBlockDescriptors,
  });

  const result = interpretPslDocumentToSqlContract({
    symbolTable,
    sourceFile,
    sourceId: 'schema.prisma',
    target: {
      kind: 'target' as const,
      familyId: 'sql' as const,
      targetId: 'postgres' as const,
      id: 'postgres',
      version: postgresTargetDescriptor.version,
      capabilities: {},
      defaultNamespaceId: 'public',
      ...ifDefined('authoring', postgresTargetDescriptor.authoring),
    },
    scalarColumnDescriptors: scalarTypeDescriptors,
    authoringContributions: assembled,
    composedExtensionContracts: new Map(),
    createNamespace: postgresCreateNamespace,
    codecLookup: createPostgresBuiltinCodecLookup(),
    capabilities: { sql: { scalarList: true } },
  });

  if (!result.ok) throw new Error(`PSL interpretation failed: ${JSON.stringify(result)}`);
  return {
    ...(result.value as Contract<SqlStorage>),
    defaultControlPolicy: control,
  } as PostgresContract;
}

async function migrateFromEmpty(
  driver: PostgresControlDriver,
  contract: PostgresContract,
): Promise<void> {
  const planner = postgresTargetDescriptor.createPlanner(controlAdapter);
  const planResult = planner.plan({
    contract,
    schema: emptySchema,
    policy: INIT_ADDITIVE_POLICY,
    fromContract: null,
    frameworkComponents,
    spaceId: APP_SPACE_ID,
    snapshotsImportPath: '../../snapshots',
  });
  if (planResult.kind !== 'success') {
    throw new Error(`Planner failed: ${JSON.stringify(planResult, null, 2)}`);
  }
  const runner = postgresTargetDescriptor.createRunner(familyInstance);
  const executeResult = await runner.execute({
    driver,
    perSpaceOptions: [
      {
        space: planResult.plan.spaceId ?? APP_SPACE_ID,
        plan: planResult.plan,
        migrationEdges: synthEdges(planResult.plan),
        driver,
        destinationContract: contract,
        policy: INIT_ADDITIVE_POLICY,
        frameworkComponents,
      },
    ],
  });
  if (!executeResult.ok) {
    throw new Error(`Runner failed:\n${formatRunnerFailure(executeResult.failure)}`);
  }
}

describe('ORDER BY on a pg.enum(...) native-enum column — issue #30163', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createTestDatabase>>;
  let driver: PostgresControlDriver | undefined;
  let contract: PostgresContract;

  beforeAll(async () => {
    database = await createTestDatabase();
    contract = buildContractFromPsl(PSL_WITH_NATIVE_ENUM, 'managed');
  }, testTimeout);

  afterAll(async () => {
    if (database) {
      await database.close();
    }
  }, testTimeout);

  beforeEach(async () => {
    driver = await createDriver(database.connectionString);
    await resetDatabase(driver);
    await migrateFromEmpty(driver, contract);
    await driver.query(`INSERT INTO "tickets" (id, status) VALUES
      (1, 'closed'), (2, 'open'), (3, 'closed'), (4, 'open')`);
  }, testTimeout);

  afterEach(async () => {
    if (driver) {
      await driver.close();
      driver = undefined;
    }
  }, testTimeout);

  it(
    'orders by declaration order via a qualified column-ref without a Postgres type error',
    async () => {
      const ast = SelectAst.from(TableSource.named('tickets', undefined, 'public'))
        .withProjection([
          ProjectionItem.of('id', ColumnRef.of('tickets', 'id')),
          ProjectionItem.of('status', ColumnRef.of('tickets', 'status')),
        ])
        .withOrderBy([
          OrderByItem.asc(ColumnRef.of('tickets', 'status')),
          OrderByItem.asc(ColumnRef.of('tickets', 'id')),
        ]);

      const lowered = createPostgresAdapter().lower(ast, { contract });

      // Mechanism, not just outcome: a native enum renders as a plain column,
      // not the array_position rewrite — Option 1 (casting the column inside
      // array_position) would also pass the row-order assertions below, so
      // this pins the actual fix.
      expect(lowered.sql).not.toContain('array_position');
      expect(lowered.sql).toContain('ORDER BY "tickets"."status" ASC');

      const rows = await driver!.query<{ id: number; status: string }>(lowered.sql);
      expect(rows.rows.map((r) => r.status)).toEqual(['open', 'open', 'closed', 'closed']);
      expect(rows.rows.map((r) => r.id)).toEqual([2, 4, 1, 3]);
    },
    testTimeout,
  );

  it(
    'orders by declaration order via an unqualified identifier-ref without a Postgres type error',
    async () => {
      const ast = SelectAst.from(TableSource.named('tickets', undefined, 'public'))
        .withProjection([
          ProjectionItem.of('id', ColumnRef.of('tickets', 'id')),
          ProjectionItem.of('status', ColumnRef.of('tickets', 'status')),
        ])
        .withOrderBy([
          OrderByItem.asc(IdentifierRef.of('status')),
          OrderByItem.asc(IdentifierRef.of('id')),
        ]);

      const lowered = createPostgresAdapter().lower(ast, { contract });

      expect(lowered.sql).not.toContain('array_position');
      expect(lowered.sql).toContain('ORDER BY "status" ASC');

      const rows = await driver!.query<{ id: number; status: string }>(lowered.sql);
      expect(rows.rows.map((r) => r.status)).toEqual(['open', 'open', 'closed', 'closed']);
      expect(rows.rows.map((r) => r.id)).toEqual([2, 4, 1, 3]);
    },
    testTimeout,
  );

  it(
    'orders by reverse declaration order via DESC without a Postgres type error',
    async () => {
      const ast = SelectAst.from(TableSource.named('tickets', undefined, 'public'))
        .withProjection([
          ProjectionItem.of('id', ColumnRef.of('tickets', 'id')),
          ProjectionItem.of('status', ColumnRef.of('tickets', 'status')),
        ])
        .withOrderBy([
          OrderByItem.desc(ColumnRef.of('tickets', 'status')),
          OrderByItem.asc(ColumnRef.of('tickets', 'id')),
        ]);

      const lowered = createPostgresAdapter().lower(ast, { contract });

      expect(lowered.sql).not.toContain('array_position');
      expect(lowered.sql).toContain('ORDER BY "tickets"."status" DESC');

      const rows = await driver!.query<{ id: number; status: string }>(lowered.sql);
      expect(rows.rows.map((r) => r.status)).toEqual(['closed', 'closed', 'open', 'open']);
      expect(rows.rows.map((r) => r.id)).toEqual([1, 3, 2, 4]);
    },
    testTimeout,
  );

  it(
    'sorts a NULL status without a Postgres type error',
    async () => {
      await driver!.query(`INSERT INTO "tickets" (id, status) VALUES (5, NULL)`);

      const ast = SelectAst.from(TableSource.named('tickets', undefined, 'public'))
        .withProjection([
          ProjectionItem.of('id', ColumnRef.of('tickets', 'id')),
          ProjectionItem.of('status', ColumnRef.of('tickets', 'status')),
        ])
        .withOrderBy([
          OrderByItem.asc(ColumnRef.of('tickets', 'status')),
          OrderByItem.asc(ColumnRef.of('tickets', 'id')),
        ]);

      const lowered = createPostgresAdapter().lower(ast, { contract });

      expect(lowered.sql).not.toContain('array_position');

      const rows = await driver!.query<{ id: number; status: string | null }>(lowered.sql);
      // Plain ORDER BY sorts NULLs last (ASC default), same as array_position would have.
      expect(rows.rows.map((r) => r.status)).toEqual(['open', 'open', 'closed', 'closed', null]);
      expect(rows.rows.map((r) => r.id)).toEqual([2, 4, 1, 3, 5]);
    },
    testTimeout,
  );

  it(
    'DISTINCT ON a native-enum column matches its ORDER BY, both as a plain column',
    async () => {
      const ast = SelectAst.from(TableSource.named('tickets', undefined, 'public'))
        .withProjection([
          ProjectionItem.of('id', ColumnRef.of('tickets', 'id')),
          ProjectionItem.of('status', ColumnRef.of('tickets', 'status')),
        ])
        .withDistinctOn([IdentifierRef.of('status')])
        .withOrderBy([
          OrderByItem.asc(IdentifierRef.of('status')),
          OrderByItem.asc(IdentifierRef.of('id')),
        ]);

      const lowered = createPostgresAdapter().lower(ast, { contract });

      // Postgres requires ORDER BY to be prefixed by the DISTINCT ON
      // expressions; array_position on one side and a bare column on the
      // other would violate that. Both must render identically.
      expect(lowered.sql).not.toContain('array_position');
      expect(lowered.sql).toContain('DISTINCT ON ("status")');
      expect(lowered.sql).toContain('ORDER BY "status" ASC, "id" ASC');

      const rows = await driver!.query<{ id: number; status: string }>(lowered.sql);
      // One row per distinct status, in declaration order (open, closed).
      expect(rows.rows.map((r) => r.status)).toEqual(['open', 'closed']);
      expect(rows.rows.map((r) => r.id)).toEqual([2, 1]);
    },
    testTimeout,
  );
});
