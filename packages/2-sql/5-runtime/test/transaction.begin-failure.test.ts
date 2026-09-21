import { describe, expect, it, vi } from 'vitest';
import { type RuntimeConnection, withTransaction } from '../src/sql-runtime';

describe('withTransaction begin failure', () => {
  it('destroys the connection without running the callback or retrying', async () => {
    const beginError = new Error('begin failed');
    const connection = {
      query: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn().mockRejectedValue(beginError),
      release: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockResolvedValue(undefined),
    } satisfies RuntimeConnection;
    const runtime = { connection: vi.fn().mockResolvedValue(connection) };
    const callback = vi.fn().mockResolvedValue('result');

    await expect(withTransaction(runtime, callback)).rejects.toBe(beginError);

    expect(connection.destroy).toHaveBeenCalledExactlyOnceWith(beginError);
    expect(connection.release).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
    expect(runtime.connection).toHaveBeenCalledOnce();
    expect(connection.transaction).toHaveBeenCalledOnce();
  });

  it('preserves the begin error when connection destruction also fails', async () => {
    const beginError = new Error('begin failed');
    const connection = {
      query: vi.fn(),
      execute: vi.fn(),
      transaction: vi.fn().mockRejectedValue(beginError),
      release: vi.fn().mockResolvedValue(undefined),
      destroy: vi.fn().mockRejectedValue(new Error('destroy failed')),
    } satisfies RuntimeConnection;
    const runtime = { connection: vi.fn().mockResolvedValue(connection) };
    const callback = vi.fn().mockResolvedValue('result');

    await expect(withTransaction(runtime, callback)).rejects.toBe(beginError);

    expect(connection.destroy).toHaveBeenCalledExactlyOnceWith(beginError);
    expect(connection.release).not.toHaveBeenCalled();
    expect(callback).not.toHaveBeenCalled();
  });
});
