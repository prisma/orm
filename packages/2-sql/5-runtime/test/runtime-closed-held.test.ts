import type { MarkerReadResult, SqlQueryable } from '@internal/sql-relational-core/ast';
import { describe, expect, it, vi } from 'vitest';
import { withTransaction } from '../src/sql-runtime';
import {
  affectedCountPlan,
  afterRefusalBegins,
  closedError,
  delay,
  rowsPlan,
  setup,
  setupWithMarkerReader,
} from './closed-runtime-stub';

function absentMarkerReader() {
  return vi.fn<(queryable: SqlQueryable) => Promise<MarkerReadResult>>(async () => ({
    kind: 'absent',
  }));
}

describe('a connection held when close() is called', () => {
  it('keeps working, reads the marker through itself, and holds the close until it is released', async () => {
    const readMarker = absentMarkerReader();
    const { runtime, driver, connection } = setupWithMarkerReader(readMarker);
    const held = await runtime.connection();
    let closed = false;
    const closing = runtime.close().then(() => {
      closed = true;
    });

    await expect(held.query(rowsPlan()).toArray()).resolves.toEqual([
      { id: 1 },
      { id: 2 },
      { id: 3 },
    ]);
    await expect(held.execute(affectedCountPlan())).resolves.toEqual({ affectedRows: 1 });
    expect(readMarker).toHaveBeenCalledTimes(1);
    expect(readMarker).toHaveBeenCalledWith(connection);
    expect(readMarker).not.toHaveBeenCalledWith(driver);
    expect(closed).toBe(false);

    await held.release();
    await closing;
    expect(closed).toBe(true);
  });
});

describe('withTransaction when close() is called inside the callback', () => {
  it('runs the callback, commits, releases, resolves with the value, and the driver closes afterwards', async () => {
    const readMarker = absentMarkerReader();
    const { runtime, calls, transaction } = setupWithMarkerReader(readMarker);
    let closing: Promise<void> | undefined;

    const result = await withTransaction(runtime, async (tx) => {
      closing = runtime.close();
      await tx.execute(affectedCountPlan());
      return 'committed';
    });
    await closing;

    expect(result).toBe('committed');
    expect(readMarker).toHaveBeenCalledWith(transaction);
    expect(calls).toEqual([
      'acquire',
      'transaction.execute',
      'commit',
      'release',
      'close',
      'closed',
    ]);
  });
});

describe('a transaction and a reload on the runtime that follow each other from the turn of close()', () => {
  it('both complete, because the runtime is busy with database work until the reload ends', async () => {
    const { runtime, calls, hooks } = setup();
    hooks.execute = () => delay(5);
    hooks.commit = () => delay(5);

    const closing = runtime.close();
    const chain = (async () => {
      await withTransaction(runtime, async (tx) => {
        await tx.execute(affectedCountPlan());
        await tx.execute(affectedCountPlan());
      });
      return runtime.execute(affectedCountPlan());
    })();

    await expect(chain).resolves.toEqual({ affectedRows: 1 });
    await closing;
    expect(calls).toEqual([
      'acquire',
      'transaction.execute',
      'transaction.execute',
      'commit',
      'release',
      'driver.execute',
      'close',
      'closed',
    ]);
  });
});

describe('a runtime-scope query inside a transaction callback after the runtime was idle for a turn of the event loop', () => {
  it('is refused at once, the transaction rolls back, and the close settles', async () => {
    const { runtime, calls, driver } = setup();
    let closing: Promise<void> | undefined;

    const pending = withTransaction(runtime, async () => {
      closing = runtime.close();
      await afterRefusalBegins();
      await runtime.execute(affectedCountPlan());
    });

    await expect(pending).rejects.toMatchObject(closedError);
    await closing;
    expect(driver.execute).not.toHaveBeenCalled();
    expect(calls).toEqual(['acquire', 'close', 'rollback', 'release', 'closed']);
  });
});

describe('a marker read that fails', () => {
  it('is retried by the next query instead of failing every later query', async () => {
    const readMarker = vi
      .fn<(queryable: SqlQueryable) => Promise<MarkerReadResult>>()
      .mockRejectedValueOnce(new Error('simulated transient failure'))
      .mockResolvedValue({ kind: 'absent' });
    const { runtime, driver } = setupWithMarkerReader(readMarker);

    await expect(runtime.execute(affectedCountPlan())).rejects.toThrow(
      'simulated transient failure',
    );
    await expect(runtime.execute(affectedCountPlan())).resolves.toEqual({ affectedRows: 1 });

    expect(readMarker).toHaveBeenCalledTimes(2);
    expect(driver.execute).toHaveBeenCalledTimes(1);
  });
});
