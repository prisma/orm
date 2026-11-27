import { EventEmitter } from 'node:events';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { type Clock, livenessCheckSettings, poolClientUse } from '../src/liveness-check';
import { createBoundDriverFromBinding } from '../src/postgres-driver';

function fakeClock(): Clock & { advance(millis: number): void; shiftWall(millis: number): void } {
  let wall = 1_000_000;
  let monotonic = 5_000;
  return {
    now: () => ({ wall, monotonic }),
    advance(millis) {
      wall += millis;
      monotonic += millis;
    },
    shiftWall(millis) {
      wall += millis;
    },
  };
}

const original = { ...livenessCheckSettings };

beforeEach(() => {
  Object.assign(livenessCheckSettings, { checkAfterIdleMillis: 1000, timeoutMillis: 5000 });
});

afterEach(() => {
  Object.assign(livenessCheckSettings, original);
});

describe('the record of when each pooled client was last used', () => {
  function setUp() {
    const pool = new EventEmitter();
    const clock = fakeClock();
    return { pool, clock, use: poolClientUse(pool, clock) };
  }

  it('uses a client unchecked within the threshold of the pool opening it', () => {
    const { pool, clock, use } = setUp();
    const client = {};
    pool.emit('connect', client);
    clock.advance(999);

    expect(use.verdict(client)).toBe('use');
  });

  it('uses a client unchecked within the threshold of its release', () => {
    const { pool, clock, use } = setUp();
    const client = {};
    pool.emit('connect', client);
    clock.advance(5000);
    pool.emit('release', undefined, client);
    clock.advance(999);

    expect(use.verdict(client)).toBe('use');
  });

  it('checks a client idle for the threshold or longer', () => {
    const { pool, clock, use } = setUp();
    const client = {};
    pool.emit('release', undefined, client);
    clock.advance(1000);

    expect(use.verdict(client)).toBe('check');
  });

  it('reads the threshold when it decides', () => {
    const { pool, clock, use } = setUp();
    const client = {};
    pool.emit('release', undefined, client);
    clock.advance(20);
    livenessCheckSettings.checkAfterIdleMillis = 10;

    expect(use.verdict(client)).toBe('check');
  });

  it('checks a client it has no record of', () => {
    const { use } = setUp();

    expect(use.verdict({})).toBe('check');
  });

  it('checks a client when the wall clock was set back', () => {
    const { pool, clock, use } = setUp();
    const client = {};
    pool.emit('release', undefined, client);
    clock.shiftWall(-10);

    expect(use.verdict(client)).toBe('check');
  });

  it('checks a client when one clock says it idled past the threshold', () => {
    const { pool, clock, use } = setUp();
    const client = {};
    pool.emit('release', undefined, client);
    clock.advance(100);
    clock.shiftWall(5000);

    expect(use.verdict(client)).toBe('check');
  });

  it('evicts a client last used strictly before a failed check started, and keeps one used at that instant', () => {
    const { pool, clock, use } = setUp();
    const older = {};
    const atStart = {};
    pool.emit('release', undefined, older);
    clock.advance(1);
    pool.emit('release', undefined, atStart);
    const startedAt = use.now();
    clock.advance(10);

    use.recordFailedCheck(startedAt);

    expect([use.verdict(older), use.verdict(atStart)]).toEqual(['evict', 'use']);
  });

  it('keeps a client released while a failed check was pending', () => {
    const { pool, clock, use } = setUp();
    const client = {};
    const startedAt = use.now();
    clock.advance(10);
    pool.emit('release', undefined, client);
    clock.advance(10);

    use.recordFailedCheck(startedAt);

    expect(use.verdict(client)).toBe('use');
  });

  it('evicts a client it has no record of once a check failed', () => {
    const { use } = setUp();
    use.recordFailedCheck(use.now());

    expect(use.verdict({})).toBe('evict');
  });

  it('keeps the later start when two checks fail', () => {
    const { pool, clock, use } = setUp();
    const earlierStart = use.now();
    clock.advance(10);
    const client = {};
    pool.emit('release', undefined, client);
    clock.advance(10);
    const laterStart = use.now();

    use.recordFailedCheck(laterStart);
    use.recordFailedCheck(earlierStart);

    expect(use.verdict(client)).toBe('evict');
  });

  it('is one record per pool, however often it is asked for', () => {
    const pool = new EventEmitter();

    expect(poolClientUse(pool)).toBe(poolClientUse(pool));
    expect([pool.listenerCount('connect'), pool.listenerCount('release')]).toEqual([1, 1]);
  });
});

describe('two drivers over one pool', () => {
  it('add one connect and one release listener to it', async () => {
    const pool = new pg.Pool({ max: 1 });
    const before = [pool.listenerCount('connect'), pool.listenerCount('release')];

    const drivers = [0, 1].map(() =>
      createBoundDriverFromBinding({ kind: 'pgPool', pool, ownedByDriver: false }, undefined),
    );

    expect([pool.listenerCount('connect'), pool.listenerCount('release')]).toEqual([
      (before[0] ?? 0) + 1,
      (before[1] ?? 0) + 1,
    ]);
    for (const driver of drivers) await driver.close();
    await pool.end();
  });
});
