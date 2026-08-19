/**
 * PSL-authored scalar lists lower to native array columns, and element values
 * round-trip with fidelity through the authored path — proven end-to-end against
 * a real Postgres database over the production authoring/migration/infer flow.
 */
import postgresAdapter from '@internal/adapter-postgres/control';
import type { Contract } from '@internal/contract/types';
import postgresControlDriver from '@internal/driver-postgres/control';
import sql, { INIT_ADDITIVE_POLICY } from '@internal/family-sql/control';
import { APP_SPACE_ID, createControlStack } from '@internal/framework-components/control';
import { flatPslModels } from '@internal/framework-components/psl-ast';
import { buildFabricatedMigrationEdge } from '@internal/migration-tools/aggregate';
import type { SqlStorage } from '@internal/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  InsertAst,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import postgres from '@internal/target-postgres/control';
import { createDevDatabase, type DevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestRuntimeFromClient } from '../utils';
import {
  authorSqlContractFromPsl,
  findStorageColumn,
  listCodecRefFor,
  postgresFrameworkComponents,
  tableNameForColumn,
} from './psl-list-authoring';

const controlStack = createControlStack({
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresControlDriver,
  extensions: [],
});
const familyInstance = sql.create(controlStack);

async function migrateContract(
  connectionString: string,
  contract: Contract<SqlStorage>,
): Promise<void> {
  const driver = await postgresControlDriver.create(connectionString);
  try {
    const schema = await familyInstance.introspect({ driver });
    const planner = postgres.createPlanner(postgresAdapter.create(controlStack));
    const planResult = planner.plan({
      contract,
      schema,
      policy: INIT_ADDITIVE_POLICY,
      fromContract: null,
      frameworkComponents: postgresFrameworkComponents,
      spaceId: APP_SPACE_ID,
      snapshotsImportPath: '../../snapshots',
    });
    if (planResult.kind !== 'success') {
      throw new Error(`planner failed: ${JSON.stringify(planResult)}`);
    }

    const runner = postgres.createRunner(familyInstance);
    const runResult = await runner.execute({
      driver,
      perSpaceOptions: [
        {
          space: APP_SPACE_ID,
          plan: planResult.plan,
          migrationEdges: [
            buildFabricatedMigrationEdge({
              currentMarkerStorageHash: planResult.plan.origin?.storageHash,
              destinationStorageHash: planResult.plan.destination.storageHash,
              operationCount: planResult.plan.operations.length,
            }),
          ],
          driver,
          destinationContract: contract,
          policy: INIT_ADDITIVE_POLICY,
          frameworkComponents: postgresFrameworkComponents,
        },
      ],
    });
    if (!runResult.ok) {
      throw new Error(`runner failed: ${JSON.stringify(runResult.failure)}`);
    }
  } finally {
    await driver.close();
  }
}

describe('PSL scalar-list end-to-end', { concurrent: false }, () => {
  let database: DevDatabase | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it(
    'posts.tags String[] authors → migrates as text[] → infers back to tags String[]',
    async () => {
      if (!database) throw new Error('database not initialised');

      const authored = await authorSqlContractFromPsl(`model Post {
  id   Int      @id
  tags String[]
}`);
      expect(authored.ok).toBe(true);
      const contract = authored.contract;
      if (!contract) throw new Error('authoring produced no contract');

      const tagsColumn = findStorageColumn(contract, 'tags');
      expect(tagsColumn).toMatchObject({
        codecId: 'pg/text@1',
        nativeType: 'text',
        many: true,
      });
      expect(tagsColumn?.['nativeType']).not.toBe('jsonb');

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString, contract);

      await withClient(database.connectionString, async (client) => {
        const formatted = await client.query<{ attname: string; formatted_type: string }>(
          `SELECT a.attname, format_type(a.atttypid, a.atttypmod) AS formatted_type
             FROM pg_catalog.pg_attribute a
             JOIN pg_catalog.pg_class c ON c.oid = a.attrelid
             JOIN pg_catalog.pg_namespace n ON n.oid = c.relnamespace
            WHERE n.nspname = 'public' AND a.attname = 'tags'
              AND a.attnum > 0 AND NOT a.attisdropped`,
        );
        expect(formatted.rows[0]?.formatted_type).toBe('text[]');
      });

      const driver = await postgresControlDriver.create(database.connectionString);
      try {
        const schemaIR = await familyInstance.introspect({ driver });
        const inferredAst = familyInstance.inferPslContract(schemaIR);
        const models = flatPslModels(inferredAst);
        const postModel = models.find((model) =>
          model.fields.some((field) => field.name === 'tags'),
        );
        expect(postModel).toBeDefined();
        const tagsField = postModel?.fields.find((field) => field.name === 'tags');
        expect(tagsField).toMatchObject({
          name: 'tags',
          typeName: 'String',
          list: true,
          optional: false,
        });
      } finally {
        await driver.close();
      }
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'DateTime[]/Bytes[]/Decimal[] authored in PSL round-trip element values',
    async () => {
      if (!database) throw new Error('database not initialised');

      const authored = await authorSqlContractFromPsl(`types {
  Amount = Numeric(30, 10)
}

model Reading {
  id       Int        @id
  dates    DateTime[]
  payloads Bytes[]
  amounts  Amount[]
}`);
      expect(authored.ok).toBe(true);
      const contract = authored.contract;
      if (!contract) throw new Error('authoring produced no contract');

      expect(findStorageColumn(contract, 'dates')).toMatchObject({
        codecId: 'pg/timestamptz-temporal@1',
        many: true,
      });
      expect(findStorageColumn(contract, 'payloads')).toMatchObject({
        codecId: 'pg/bytea@1',
        many: true,
      });
      expect(findStorageColumn(contract, 'amounts')).toMatchObject({
        codecId: 'pg/numeric@1',
        many: true,
      });

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString, contract);

      const tableName = tableNameForColumn(contract, 'dates');
      const table = TableSource.named(tableName);
      const datesRef = listCodecRefFor(contract, 'dates');
      const payloadsRef = listCodecRefFor(contract, 'payloads');
      const amountsRef = listCodecRefFor(contract, 'amounts');

      const dates = [
        Temporal.Instant.from('2026-01-02T03:04:05Z'),
        Temporal.Instant.from('2025-06-15T12:00:00Z'),
      ];
      const payloads = [new Uint8Array([1, 2, 3]), new Uint8Array([255, 0, 127])];
      const amounts = ['1.5', '999999999999.99', '-0.001'];

      await withClient(database.connectionString, async (client) => {
        const runtime = await createTestRuntimeFromClient(contract, client, {
          verifyMarker: false,
        });

        const insert = InsertAst.into(table).withRows([
          {
            id: ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } }),
            dates: ParamRef.of(dates, { codec: datesRef }),
            payloads: ParamRef.of(payloads, { codec: payloadsRef }),
            amounts: ParamRef.of(amounts, { codec: amountsRef }),
          },
        ]);
        await runtime.execute(planFromAst(insert, contract));

        const select = SelectAst.from(table)
          .withProjection([
            ProjectionItem.of('dates', ColumnRef.of(tableName, 'dates'), datesRef),
            ProjectionItem.of('payloads', ColumnRef.of(tableName, 'payloads'), payloadsRef),
            ProjectionItem.of('amounts', ColumnRef.of(tableName, 'amounts'), amountsRef),
          ])
          .withWhere(
            BinaryExpr.eq(
              ColumnRef.of(tableName, 'id'),
              ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } }),
            ),
          );

        const rows = await runtime.query(planFromAst(select, contract)).toArray();
        expect(rows).toHaveLength(1);
        // `rows[0]!` rather than a hop through `unknown`: the plan is built from a dynamically
        // assembled AST, so it carries no literal row type and indexing yields `undefined` under
        // `noUncheckedIndexedAccess`. The length assertion above is what rules that out. Going
        // through `unknown` hid both that and the element types — `dates` read as `Date[]` here
        // long after the column started handing back `Temporal.Instant`.
        const row = rows[0]! as {
          dates: Temporal.Instant[];
          payloads: Uint8Array[];
          amounts: string[];
        };

        expect(row.dates.map((value) => value.toString())).toEqual(
          dates.map((value) => value.toString()),
        );
        expect(row.payloads.map((value) => [...value])).toEqual(
          payloads.map((value) => [...value]),
        );
        expect(row.amounts).toEqual(amounts);
      });
    },
    timeouts.spinUpPpgDev,
  );

  it(
    'String[]/Int[] authored in PSL round-trip element values',
    async () => {
      if (!database) throw new Error('database not initialised');

      const authored = await authorSqlContractFromPsl(`model Item {
  id     Int      @id
  tags   String[]
  scores Int[]
}`);
      expect(authored.ok).toBe(true);
      const contract = authored.contract;
      if (!contract) throw new Error('authoring produced no contract');

      expect(findStorageColumn(contract, 'tags')).toMatchObject({
        codecId: 'pg/text@1',
        many: true,
      });
      expect(findStorageColumn(contract, 'scores')).toMatchObject({
        codecId: 'pg/int4@1',
        many: true,
      });

      await withClient(database.connectionString, async (client) => {
        await client.query('DROP SCHEMA IF EXISTS public CASCADE');
        await client.query('CREATE SCHEMA public');
        await client.query('DROP SCHEMA IF EXISTS prisma_contract CASCADE');
      });
      await migrateContract(database.connectionString, contract);

      const tableName = tableNameForColumn(contract, 'tags');
      const table = TableSource.named(tableName);
      const tagsRef = listCodecRefFor(contract, 'tags');
      const scoresRef = listCodecRefFor(contract, 'scores');

      const tags = ['a', 'b', 'c'];
      const scores = [1, 2, 3];

      await withClient(database.connectionString, async (client) => {
        const runtime = await createTestRuntimeFromClient(contract, client, {
          verifyMarker: false,
        });

        const insert = InsertAst.into(table).withRows([
          {
            id: ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } }),
            tags: ParamRef.of(tags, { codec: tagsRef }),
            scores: ParamRef.of(scores, { codec: scoresRef }),
          },
        ]);
        await runtime.execute(planFromAst(insert, contract));

        const select = SelectAst.from(table)
          .withProjection([
            ProjectionItem.of('tags', ColumnRef.of(tableName, 'tags'), tagsRef),
            ProjectionItem.of('scores', ColumnRef.of(tableName, 'scores'), scoresRef),
          ])
          .withWhere(
            BinaryExpr.eq(
              ColumnRef.of(tableName, 'id'),
              ParamRef.of(1, { codec: { codecId: 'pg/int4@1' } }),
            ),
          );

        const rows = await runtime.query(planFromAst(select, contract)).toArray();
        expect(rows).toHaveLength(1);
        const row = rows[0]! as {
          tags: string[];
          scores: number[];
        };

        expect(row.tags).toEqual(tags);
        expect(row.scores).toEqual(scores);
      });
    },
    timeouts.spinUpPpgDev,
  );
});
