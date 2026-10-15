import { describe, expect, it, vi } from 'vitest';
import { withMutationScope } from '../../src/mutation-graph/mutation-scope';
import { createMockRuntime } from '../helpers';

describe('withMutationScope', () => {
  it('commits the transaction of the runtime when the work succeeds', async () => {
    const runtime = createMockRuntime();
    const commit = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const transaction = {
      query: runtime.query.bind(runtime),
      execute: runtime.execute.bind(runtime),
      commit,
      rollback,
    };
    const scoped = Object.assign(runtime, { transaction: async () => transaction });

    expect(await withMutationScope(scoped, async (scope) => scope === transaction)).toBe(true);
    expect(commit).toHaveBeenCalledTimes(1);
    expect(rollback).not.toHaveBeenCalled();
  });

  it('rolls the transaction back and rethrows when the work fails', async () => {
    const runtime = createMockRuntime();
    const commit = vi.fn(async () => undefined);
    const rollback = vi.fn(async () => undefined);
    const transaction = {
      query: runtime.query.bind(runtime),
      execute: runtime.execute.bind(runtime),
      commit,
      rollback,
    };
    const scoped = Object.assign(runtime, { transaction: async () => transaction });
    const failure = new Error('statement failed');

    await expect(
      withMutationScope(scoped, async () => {
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(commit).not.toHaveBeenCalled();
    expect(rollback).toHaveBeenCalledTimes(1);
  });

  it('runs in a transaction that has no commit or rollback hook', async () => {
    const runtime = createMockRuntime();
    const transaction = {
      query: runtime.query.bind(runtime),
      execute: runtime.execute.bind(runtime),
    };
    const scoped = Object.assign(runtime, { transaction: async () => transaction });

    expect(await withMutationScope(scoped, async (scope) => scope === transaction)).toBe(true);
  });

  it('releases a connection it opened when the runtime has no transaction of its own', async () => {
    const runtime = createMockRuntime();
    const release = vi.fn(async () => undefined);
    const connection = {
      query: runtime.query.bind(runtime),
      execute: runtime.execute.bind(runtime),
      release,
    };
    const scoped = Object.assign(runtime, { connection: async () => connection });

    expect(await withMutationScope(scoped, async (scope) => scope === connection)).toBe(true);
    expect(release).toHaveBeenCalledTimes(1);
  });

  it('runs on the runtime itself when it has neither a transaction nor a connection', async () => {
    const runtime = createMockRuntime();

    expect(await withMutationScope(runtime, async (scope) => scope === runtime)).toBe(true);
  });
});
