import postgresAdapter from '@internal/adapter-postgres/runtime';
import { instantiateExecutionStack } from '@internal/framework-components/execution';
import type { SqlDriver, SqlTransactionOptions } from '@internal/sql-relational-core/ast';
import { createSqlExecutionStack, type SqlMiddleware, SqlRuntimeBase } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';
import { describe, expect, it, vi } from 'vitest';
import { orm } from '../src/orm';
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
    beginTransaction: vi.fn(async (_start?: SqlTransactionOptions) => {
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

describe('ORM factory policy through activity rebinding', () => {
  it.each([undefined, { isolationLevel: 'ReadCommitted' }])(
    'forwards policy %j for nested create and update',
    async (implicitTransactionOptions) => {
      const failure = new Error('stop before writes');
      const { runtime, connection } = setup(failure);
      const models = orm({ context: getTestContext(), runtime, implicitTransactionOptions });
      try {
        await expect(
          models.public.User.select('id').create({
            id: 1,
            name: 'Ada',
            email: 'ada@example.com',
            posts: (posts) => posts.connect({ id: 1 }),
          }),
        ).rejects.toBe(failure);
        await expect(
          models.public.User.where({ id: 1 })
            .select('id')
            .update({
              posts: (posts) => posts.connect({ id: 1 }),
            }),
        ).rejects.toBe(failure);
        expect(connection.beginTransaction.mock.calls).toEqual([
          [implicitTransactionOptions],
          [implicitTransactionOptions],
        ]);
      } finally {
        await runtime.close();
      }
    },
  );
});

function nestedUpdate(runtime: Parameters<typeof orm>[0]['runtime']) {
  return orm({
    context: getTestContext(),
    runtime,
    implicitTransactionOptions: { isolationLevel: 'ReadCommitted' },
  })
    .public.User.where({ id: 1 })
    .select('id')
    .update({ posts: (posts) => posts.connect({ id: 1 }) });
}

describe('mutation graph with production runtime activities', () => {
  it('applies policy and releases a committed graph transaction', async () => {
    const { runtime, connection, transaction } = setup();
    try {
      expect(await nestedUpdate(runtime)).toBeNull();
      expect(connection.beginTransaction).toHaveBeenCalledExactlyOnceWith({
        isolationLevel: 'ReadCommitted',
      });
      expect(transaction.commit).toHaveBeenCalledTimes(1);
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect(connection.destroy).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });

  it('participates in an existing transaction without resetting its isolation', async () => {
    const { runtime, connection, transaction } = setup();
    try {
      const held = await runtime.connection();
      const existing = await held.transaction({ isolationLevel: 'Serializable' });
      expect(await nestedUpdate(existing)).toBeNull();
      expect(connection.beginTransaction).toHaveBeenCalledExactlyOnceWith({
        isolationLevel: 'Serializable',
      });
      expect(transaction.commit).not.toHaveBeenCalled();
      await existing.commit();
      expect(transaction.commit).toHaveBeenCalledTimes(1);
      await held.release();
    } finally {
      await runtime.close();
    }
  });

  it('destroys after an attempted start using the production destroy capability', async () => {
    const failure = new Error('begin failed');
    const { runtime, connection } = setup(failure);
    try {
      await expect(nestedUpdate(runtime)).rejects.toBe(failure);
      expect(connection.beginTransaction).toHaveBeenCalledExactlyOnceWith({
        isolationLevel: 'ReadCommitted',
      });
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
      await expect(nestedUpdate(runtime)).rejects.toBe(failure);
      expect(connection.beginTransaction).not.toHaveBeenCalled();
      expect(connection.release).toHaveBeenCalledTimes(1);
      expect(connection.destroy).not.toHaveBeenCalled();
    } finally {
      await runtime.close();
    }
  });
});
