import type { Client } from 'pg';
import { expect, it, vi } from 'vitest';
import { createBoundDriverFromBinding } from '../src/postgres-driver';

it('attempts supplied-client rollback even when closing its parked cursor fails', async () => {
  const client = {
    connect: vi.fn(async () => {}),
    end: vi.fn(async () => {}),
    on: vi.fn(),
    query: vi.fn((request: unknown) => {
      if (typeof request === 'object' && request !== null && 'read' in request) {
        return {
          read: (_size: number, done: (error: null, rows: { id: number }[]) => void) =>
            done(null, [{ id: 1 }]),
          close: (done: (error: Error) => void) => done(new Error('cursor close failed')),
        };
      }
      return Promise.resolve({ rows: [], rowCount: 0 });
    }),
  };
  const driver = createBoundDriverFromBinding(
    { kind: 'pgClient', client: client as unknown as Client, ownedByDriver: false },
    { batchSize: 1 },
  );
  const connection = await driver.acquireConnection();
  const tx = await connection.beginTransaction();
  const rows = tx.query({ sql: 'SELECT 1' })[Symbol.asyncIterator]();
  await rows.next();
  await connection.destroy(new Error('timeout')).catch(() => undefined);
  expect(
    client.query.mock.calls
      .map(([request]) => request)
      .filter((request) => typeof request === 'string'),
  ).toEqual(['BEGIN', 'ROLLBACK']);
  expect(client.end).not.toHaveBeenCalled();
  expect(driver.state).toBe('closed');
  await rows.return?.().catch(() => undefined);
});
