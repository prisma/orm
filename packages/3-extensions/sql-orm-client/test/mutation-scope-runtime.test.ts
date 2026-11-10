import postgresAdapter from '@internal/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { SqlDriver, SqlTransactionStart } from '@internal/sql-relational-core/ast';
import { createSqlExecutionStack, type SqlMiddleware, SqlRuntimeBase } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it, vi } from 'vitest';
import { withMutationScope } from '../src/mutation-executor';
import { getTestContext } from './helpers';

class TestRuntime extends SqlRuntimeBase {}

function setup(failure?: Error, middleware: readonly SqlMiddleware[] = []) {
  const queryable = {
    query: async function* () {},
    execute: async () => ({ affectedRows: 0 }),
  };
  const transaction = {
    ...queryable,
    commit: vi.fn(async () => undefined),
    rollback: vi.fn(async () => undefined),
  };
  const connection = {
    ...queryable,
    beginTransaction: vi.fn(async (_start?: SqlTransactionStart) => {
      if (failure) throw failure;
      return transaction;
    }),
    release: vi.fn(async () => undefined),
    destroy: vi.fn(async (_reason?: unknown) => undefined),
  };
  const driver: SqlDriver = {
    ...queryable,
    connect: async () => undefined,
    close: async () => undefined,
    acquireConnection: async () => connection,
  };
  const { adapter } = instantiateExecutionStack(
    createSqlExecutionStack({ target: postgresTarget, adapter: postgresAdapter, extensions: [] }),
  );
  const runtime = new TestRuntime({
    context: getTestContext(),
    adapter,
    driver,
    verifyMarker: false,
    middleware,
  });
  return { runtime, connection, transaction };
}

describe('mutation fallback with production runtime connections', () => {
  it('forwards implicit intent and releases a committed fallback transaction', async () => {
    const { runtime, connection, transaction } = setup();
    try {
      expect(await withMutationScope(runtime, async () => 42)).toBe(42);
      expect(connection.beginTransaction).toHaveBeenCalledExactlyOnceWith({ kind: 'implicit' });
      expect(transaction.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect(connection.destroy).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });

  it('destroys after an attempted start using the production destroy capability', async () => {
    const failure = new Error('begin failed');
    const { runtime, connection } = setup(failure);
    try {
      await expect(withMutationScope(runtime, async () => 42)).rejects.toBe(failure);
      expect(connection.beginTransaction).toHaveBeenCalledExactlyOnceWith({ kind: 'implicit' });
      expect(connection.destroy).toHaveBeenCalledExactlyOnceWith(failure);
      expect(connection.release).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });

  it('preserves production refusal metadata and releases without attempting BEGIN', async () => {
    const failure = new Error('middleware refused');
    const { runtime, connection } = setup(undefined, [
      {
        name: 'refusal',
        async activityStarted(activity) {
          if (activity.kind === 'transaction') throw failure;
        },
      },
    ]);
    try {
      await expect(withMutationScope(runtime, async () => 42)).rejects.toBe(failure);
      expect(connection.beginTransaction).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect(connection.destroy).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });
});
