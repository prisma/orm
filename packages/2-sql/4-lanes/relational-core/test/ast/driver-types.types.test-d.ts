import { expectTypeOf, test } from 'vitest';
import type {
  SqlConnection,
  SqlDriver,
  SqlExecuteRequest,
  SqlStatementStats,
  SqlTransaction,
  SqlTransactionOptions,
} from '../../src/ast/driver-types';

type PoolBinding = { pool: { connect: () => Promise<unknown> } };
type ClientBinding = { client: { query: (sql: string) => Promise<unknown> } };
type TestBinding = PoolBinding | ClientBinding;

test('SqlDriver interface supports connect(binding: TBinding)', () => {
  expectTypeOf<SqlDriver<TestBinding>>()
    .toHaveProperty('connect')
    .parameter(0)
    .toEqualTypeOf<TestBinding>();
});

test('SqlDriver default TBinding is void', () => {
  expectTypeOf<SqlDriver>().toHaveProperty('connect');
  expectTypeOf<SqlDriver>().toExtend<SqlDriver<void>>();
});

test('mock driver implementing SqlDriver<TestBinding> compiles and accepts binding at connect', () => {
  const query = async function* <Row = Record<string, unknown>>(
    _request: SqlExecuteRequest,
  ): AsyncIterable<Row> {};
  const execute = async (_request: SqlExecuteRequest): Promise<SqlStatementStats> => ({
    affectedRows: 1,
  });

  const transaction: SqlTransaction = {
    query,
    execute,
    commit: async () => {},
    rollback: async () => {},
  };
  const connection: SqlConnection = {
    query,
    execute,
    beginTransaction: async () => transaction,
    release: async () => {},
    destroy: async (_reason?: unknown) => {},
  };
  const driver: SqlDriver<TestBinding> = {
    query,
    execute,
    connect: async (binding: TestBinding) => {
      expectTypeOf(binding).toEqualTypeOf<TestBinding>();
    },
    acquireConnection: async () => connection,
    close: async () => {},
  };

  expectTypeOf(driver.query<{ id: number }>({ sql: 'SELECT 1' })).toEqualTypeOf<
    AsyncIterable<{ id: number }>
  >();
  expectTypeOf(
    driver.execute({ sql: 'UPDATE example SET id = id' }),
  ).resolves.toEqualTypeOf<SqlStatementStats>();
  expectTypeOf(driver.connect).toBeFunction();
  expectTypeOf(driver.connect).parameter(0).toEqualTypeOf<TestBinding>();
});

test('beginTransaction takes an optional isolation level', () => {
  expectTypeOf<SqlConnection['beginTransaction']>()
    .parameter(0)
    .toEqualTypeOf<SqlTransactionOptions | undefined>();
  expectTypeOf<SqlTransactionOptions['isolationLevel']>().toEqualTypeOf<
    'readUncommitted' | 'readCommitted' | 'repeatableRead' | 'serializable' | undefined
  >();
});

test('a driver written without the options parameter still satisfies SqlConnection', () => {
  expectTypeOf<() => Promise<SqlTransaction>>().toExtend<SqlConnection['beginTransaction']>();
});
