import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { AsyncIterableResult } from '@internal/framework-components/runtime';
import type { SqlExecutionPlan } from '@internal/sql-relational-core/plan';
import { describe, expect, it } from 'vitest';
import { createSqlExecutionStack, type Runtime } from '../src/exports';
import {
  createTestRuntime as createRuntime,
  createStubAdapter,
  createTestAdapterDescriptor,
  createTestContext,
  createTestContract,
  createTestTargetDescriptor,
  stubAst,
  unboundNamespaceWithTables,
} from './utils';

class MockDriver {
  private rows: ReadonlyArray<Record<string, unknown>> = [];

  setRows(rows: ReadonlyArray<Record<string, unknown>>): void {
    this.rows = rows;
  }

  async *query<Row = Record<string, unknown>>(_options: {
    sql: string;
    params: readonly unknown[];
  }): AsyncIterable<Row> {
    for (const row of this.rows) {
      yield row as Row;
    }
  }

  async execute(): Promise<{ affectedRows: number }> {
    return { affectedRows: 0 };
  }

  async acquireConnection(): Promise<never> {
    throw new Error('Not implemented in mock');
  }

  async connect(): Promise<void> {}

  async close(): Promise<void> {}
}

const fixtureContract = createTestContract({
  targetFamily: 'sql',
  target: 'postgres',
  storageHash: 'test-hash',
  profileHash: 'test-profile-hash',
  storage: {
    namespaces: {
      __unbound__: unboundNamespaceWithTables({
        user: {
          columns: {
            id: { dataType: 'pg/int4', codecId: 'pg/int4@1', nullable: false },
            email: { dataType: 'pg/text', codecId: 'pg/text@1', nullable: false },
          },
          uniques: [],
          indexes: [],
          foreignKeys: [],
        },
      }),
    },
  },
  models: {},
});

function createTestRuntime(mockDriver: MockDriver): Runtime {
  const adapter = createStubAdapter();
  const stack = createSqlExecutionStack({
    target: createTestTargetDescriptor(),
    adapter: createTestAdapterDescriptor(adapter),
    extensions: [],
  });
  const stackInstance = instantiateExecutionStack(stack);
  const context = createTestContext(fixtureContract, adapter);
  return createRuntime({
    stackInstance,
    context,
    driver: mockDriver,
    verifyMarker: false,
  });
}

describe('SqlRuntime AsyncIterableResult integration', () => {
  it('returns AsyncIterableResult from query', async () => {
    const driver = new MockDriver();
    driver.setRows([
      { id: 1, email: 'test1@example.com' },
      { id: 2, email: 'test2@example.com' },
    ]);
    const runtime = createTestRuntime(driver);

    const plan: SqlExecutionPlan<{ id: number; email: string }> = {
      sql: 'SELECT id, email FROM "user" ORDER BY id',
      params: [],
      ast: stubAst(),
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test-hash',
        lane: 'sql',
      },
    };

    const result = runtime.query(plan);

    expect(result).toBeInstanceOf(Object);
    expect(typeof result.toArray).toBe('function');
    expect(typeof result[Symbol.asyncIterator]).toBe('function');

    await runtime.close();
  });

  it('preserves type information', async () => {
    const driver = new MockDriver();
    driver.setRows([{ id: 1, email: 'test@example.com' }]);
    const runtime = createTestRuntime(driver);

    const plan: SqlExecutionPlan<{ id: number; email: string }> = {
      sql: 'SELECT id, email FROM "user" LIMIT 1',
      params: [],
      ast: stubAst(),
      meta: {
        target: 'postgres',
        targetFamily: 'sql',
        storageHash: 'test-hash',
        lane: 'sql',
      },
    };

    const result: AsyncIterableResult<{ id: number; email: string }> = runtime.query(plan);
    const rows = await result.toArray();

    expect(rows.length).toBe(1);
    expect(typeof rows[0]!.id).toBe('number');
    expect(typeof rows[0]!.email).toBe('string');

    await runtime.close();
  });
});
