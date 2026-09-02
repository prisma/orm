import { type Contract, coreHash, profileHash } from '@internal/contract/types';
import postgresRuntimeDriverDescriptor from '@internal/driver-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import { SqlStorage } from '@internal/sql-contract/types';
import { InsertAst, ParamRef, TableSource } from '@internal/sql-relational-core/ast';
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

function buildContract(): Contract<SqlStorage> {
  return {
    target: 'postgres',
    targetFamily: 'sql',
    profileHash: profileHash('enum-array-inferrable-write'),
    storage: new SqlStorage({
      storageHash: coreHash('enum-array-inferrable-write'),
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: createTestSqlNamespace({
          id: UNBOUND_NAMESPACE_ID,
          entries: {
            table: {
              probe: {
                columns: {
                  id: { nativeType: 'text', codecId: 'pg/text@1', nullable: false },
                  moods: {
                    nativeType: 'text',
                    codecId: 'pg/text@1',
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

const TABLE = TableSource.named('probe');

function buildInsertAst(id: string, moods: string[]): InsertAst {
  return InsertAst.into(TABLE).withRows([
    {
      id: ParamRef.of(id, { codec: { codecId: 'pg/text@1' } }),
      moods: ParamRef.of(moods, { codec: { codecId: 'pg/text@1', many: true } }),
    },
  ]);
}

describe('array write against a native-enum-array column resolved via the untyped-parameter path (issue #30165)', {
  concurrent: false,
}, () => {
  let database: Awaited<ReturnType<typeof createDevDatabase>> | undefined;
  let runtime: Runtime | undefined;

  beforeAll(async () => {
    database = await createDevDatabase();

    await withClient(database.connectionString, async (client) => {
      await client.query(`CREATE TYPE "Mood" AS ENUM ('URGENT', 'NORMAL', 'LOW')`);
      await client.query(`
          CREATE TABLE probe (
            id    text PRIMARY KEY,
            moods "Mood"[]
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

  it('writes text[]-declared array parameters, including an empty array, into a native "Mood"[] column', {
    timeout: timeouts.spinUpPpgDev,
  }, async () => {
    const contract = buildContract();

    await runtime!
      .query(planFromAst(buildInsertAst('probe-1', ['URGENT', 'NORMAL']), contract))
      .toArray();
    await runtime!.query(planFromAst(buildInsertAst('probe-2', []), contract)).toArray();

    await withClient(database!.connectionString, async (client) => {
      const result = await client.query<{ id: string; moods: string[] }>(
        'SELECT id, moods::text[] AS moods FROM probe WHERE id = ANY($1) ORDER BY id',
        [['probe-1', 'probe-2']],
      );

      expect(result.rows).toEqual([
        { id: 'probe-1', moods: ['URGENT', 'NORMAL'] },
        { id: 'probe-2', moods: [] },
      ]);
    });
  });
});
