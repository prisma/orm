/**
 * Money parameters are cast through numeric (`$1::numeric::money`), so PostgreSQL never reads them with the session's lc_monetary separators. PGlite runs only the C locale, so this file shows the lowered SQL executes and round-trips; the unit test in sql-renderer.cast-policy.test.ts pins the cast itself.
 */

import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import {
  BinaryExpr,
  ColumnRef,
  InsertAst,
  ListExpression,
  ParamRef,
  ProjectionItem,
  SelectAst,
  TableSource,
} from '@internal/sql-relational-core/ast';
import { planFromAst } from '@internal/sql-relational-core/plan';
import {
  createExecutionContext,
  createSqlExecutionStack,
  type Runtime,
} from '@internal/sql-runtime';
import { createTestRuntime } from '@internal/sql-runtime/test/utils';
import postgresRuntimeTargetDescriptor from '@internal/target-postgres/runtime';
import { applicationDomainOf, createDevDatabase, timeouts, withClient } from '@repo/test-utils';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createTestSqlNamespace } from '../../../../2-sql-family/1-core/contract/test/test-support';
import postgresRuntimeAdapterDescriptorFull from '../src/exports/runtime';

const { queryOperations: _stripOps, ...postgresRuntimeAdapterDescriptor } =
  postgresRuntimeAdapterDescriptorFull;

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('money-param-cast'),
    storage: new SqlStorage({
      storageHash: coreHash('money-param-cast'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              prices: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  amount: { dataType: 'pg/money', codecId: 'pg/money@1', nullable: false },
                  history: {
                    dataType: 'pg/money',
                    codecId: 'pg/money@1',
                    nullable: true,
                    many: true,
                  },
                },
                primaryKey: { columns: ['id'] },
                uniques: [],
                indexes: [],
                foreignKeys: [],
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

const TABLE = TableSource.named('prices');

function insertAst(id: number, amount: string): InsertAst {
  return InsertAst.into(TABLE).withRows([
    {
      id: ParamRef.of(id, { codec: { codecId: 'pg/int4@1' } }),
      amount: ParamRef.of(amount, { codec: { codecId: 'pg/money@1' } }),
    },
  ]);
}

function selectByAmountsAst(amounts: readonly string[]): SelectAst {
  return SelectAst.from(TABLE)
    .withProjection([
      ProjectionItem.of('id', ColumnRef.of('prices', 'id'), { codecId: 'pg/int4@1' }),
      ProjectionItem.of('amount', ColumnRef.of('prices', 'amount'), { codecId: 'pg/money@1' }),
    ])
    .withWhere(
      BinaryExpr.in(
        ColumnRef.of('prices', 'amount'),
        ListExpression.of(
          amounts.map((amount) => ParamRef.of(amount, { codec: { codecId: 'pg/money@1' } })),
        ),
      ),
    );
}

describe('money parameters against a live database', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Runtime | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();
    await withClient(database.connectionString, async (client) => {
      await client.query(
        'CREATE TABLE prices (id int4 PRIMARY KEY, amount money NOT NULL, history money[])',
      );
    });

    const contract = buildContract();
    const stack = createSqlExecutionStack({
      target: postgresRuntimeTargetDescriptor,
      adapter: postgresRuntimeAdapterDescriptor,
      extensions: [],
    });
    const context = createExecutionContext({ contract, stack });
    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'url', url: database.connectionString });
    runtime = createTestRuntime({
      stackInstance: instantiateExecutionStack(stack),
      context,
      driver,
      verifyMarker: false,
    });
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    await runtime?.close();
    await database?.close();
  }, timeouts.spinUpPpgDev);

  it('writes money through numeric and filters by amounts in a list', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = buildContract();
    await runtime!.query(planFromAst(insertAst(1, '1234.50'), contract)).toArray();
    await runtime!.query(planFromAst(insertAst(2, '-0.05'), contract)).toArray();
    await runtime!.query(planFromAst(insertAst(3, '7.00'), contract)).toArray();

    const rows = await runtime!
      .query(planFromAst(selectByAmountsAst(['1234.50', '-0.05']), contract))
      .toArray();

    expect(rows).toEqual([
      { id: 1, amount: '1234.50' },
      { id: 2, amount: '-0.05' },
    ]);
  });

  it('writes a money list through numeric[]', { timeout: timeouts.spinUpPpgDev }, async () => {
    const contract = buildContract();
    const insert = InsertAst.into(TABLE).withRows([
      {
        id: ParamRef.of(10, { codec: { codecId: 'pg/int4@1' } }),
        amount: ParamRef.of('0.00', { codec: { codecId: 'pg/money@1' } }),
        history: ParamRef.of(['1.50', '2000.00', '-3.25'], {
          codec: { codecId: 'pg/money@1', many: true },
        }),
      },
    ]);
    await runtime!.query(planFromAst(insert, contract)).toArray();

    const stored = await withClient(database!.connectionString, (client) =>
      client.query('SELECT history::numeric[]::text AS history FROM prices WHERE id = 10'),
    );

    expect(stored.rows).toEqual([{ history: '{1.50,2000.00,-3.25}' }]);
  });
});
