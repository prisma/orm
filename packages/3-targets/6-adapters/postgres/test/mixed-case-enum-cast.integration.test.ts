/**
 * Integration test: native-enum casts against a mixed-case type name, executed
 * on a live database.
 *
 * Prisma ORM's migration engine names the enum type after the PSL enum —
 * PascalCase, created quoted (`CREATE TYPE "HoldType"`). Postgres case-folds
 * unquoted identifiers, so before TML-3085 the renderer's unquoted cast
 * (`$1::HoldType`) failed with `type "holdtype" does not exist` on every read
 * filtering on such an enum and every write binding one. The Supabase adoption
 * fixtures are all lowercase, where case-folding is unobservable — this file
 * keeps a mixed-case name in the live matrix so the quoting stays covered.
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
import { createTestSqlNamespace } from '../../../../2-sql/1-core/contract/test/test-support';
import postgresRuntimeAdapterDescriptorFull from '../src/exports/runtime';

const { queryOperations: _stripOps, ...postgresRuntimeAdapterDescriptor } =
  postgresRuntimeAdapterDescriptorFull;

const HOLD_TYPE_PARAMS = { typeName: 'HoldType' } as const;

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('mixed-case-enum-cast'),
    storage: new SqlStorage({
      storageHash: coreHash('mixed-case-enum-cast'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              orders: {
                columns: {
                  id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
                  hold: {
                    dataType: 'pg/enum',
                    codecId: 'pg/enum@1',
                    typeParams: HOLD_TYPE_PARAMS,
                    nullable: false,
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

const TABLE = TableSource.named('orders');

function buildInsertAst(id: number, hold: string): InsertAst {
  return InsertAst.into(TABLE).withRows([
    {
      id: ParamRef.of(id, { codec: { codecId: 'pg/int4@1' } }),
      hold: ParamRef.of(hold, {
        codec: { codecId: 'pg/enum@1', typeParams: HOLD_TYPE_PARAMS },
      }),
    },
  ]);
}

function buildSelectByHoldAst(hold: string): SelectAst {
  return SelectAst.from(TABLE)
    .withProjection([
      ProjectionItem.of('id', ColumnRef.of('orders', 'id'), { codecId: 'pg/int4@1' }),
      ProjectionItem.of('hold', ColumnRef.of('orders', 'hold'), {
        codecId: 'pg/enum@1',
        typeParams: HOLD_TYPE_PARAMS,
      }),
    ])
    .withWhere(
      BinaryExpr.eq(
        ColumnRef.of('orders', 'hold'),
        ParamRef.of(hold, { codec: { codecId: 'pg/enum@1', typeParams: HOLD_TYPE_PARAMS } }),
      ),
    );
}

describe('mixed-case native-enum cast against a live database', { concurrent: false }, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Runtime | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();

    await withClient(database.connectionString, async (client) => {
      await client.query(`CREATE TYPE "HoldType" AS ENUM ('active', 'released')`);
      await client.query(`
        CREATE TABLE orders (
          id   int4 PRIMARY KEY,
          hold "HoldType" NOT NULL
        )
      `);
    });

    const contract = buildContract();
    const stack = createSqlExecutionStack({
      target: postgresRuntimeTargetDescriptor,
      adapter: postgresRuntimeAdapterDescriptor,
      extensions: [],
    });
    const context = createExecutionContext({ contract, stack });
    const stackInstance = instantiateExecutionStack(stack);

    const driver = postgresRuntimeDriverDescriptor.create();
    await driver.connect({ kind: 'url', url: database.connectionString });

    runtime = createTestRuntime({ stackInstance, context, driver, verifyMarker: false });
  }, timeouts.spinUpPpgDev);

  afterAll(async () => {
    if (runtime) {
      await runtime.close();
      runtime = undefined;
    }
    if (database) await database.close();
  }, timeouts.spinUpPpgDev);

  it('writes and reads through the quoted PascalCase cast — before TML-3085 both failed with type "holdtype" does not exist', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = buildContract();

    await runtime!.query(planFromAst(buildInsertAst(1, 'active'), contract)).toArray();
    await runtime!.query(planFromAst(buildInsertAst(2, 'released'), contract)).toArray();

    const rows = await runtime!
      .query(planFromAst(buildSelectByHoldAst('active'), contract))
      .toArray();

    expect(rows).toEqual([{ id: 1, hold: 'active' }]);
  });
});
