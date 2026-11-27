import { Pool } from 'pg';

/** How long a pooled client may sit idle and still be used unchecked, and how long its liveness check may take. */
export const livenessCheckLimits = {
  checkAfterIdleMillis: 1000,
  timeoutMillis: 5000,
};

export interface Instant {
  readonly wall: number;
  readonly monotonic: number;
}

export interface Clock {
  now(): Instant;
}

const systemClock: Clock = {
  now: () => ({ wall: Date.now(), monotonic: performance.now() }),
};

/** What the driver does with a client it just took from the pool. */
export type CheckoutVerdict = 'use' | 'check' | 'evict';

export interface PoolLastUse {
  verdict(client: object): CheckoutVerdict;
  now(): Instant;
  /** Marks every client last used before `startedAt`, when a liveness check that started then failed, for eviction. */
  recordFailedCheck(startedAt: Instant): void;
}

interface PoolEvents {
  on(event: 'connect', listener: (client: object) => void): unknown;
  on(event: 'release', listener: (error: unknown, client: object) => void): unknown;
}

class PoolLastUseRecord implements PoolLastUse {
  readonly #clock: Clock;
  readonly #lastUsed = new WeakMap<object, Instant>();
  #evictionCutoff: number | undefined;
  #emitsConnect: boolean;

  constructor(pool: PoolEvents, clock: Clock) {
    this.#clock = clock;
    this.#emitsConnect = pool instanceof Pool;
    pool.on('connect', (client) => {
      this.#emitsConnect = true;
      this.#lastUsed.set(client, clock.now());
    });
    pool.on('release', (_error, client) => this.#lastUsed.set(client, clock.now()));
  }

  verdict(client: object): CheckoutVerdict {
    const lastUsed = this.#lastUsed.get(client);
    if (lastUsed === undefined) return this.#predatesRecord() ? 'evict' : 'check';
    if (this.#evictionCutoff !== undefined && lastUsed.monotonic < this.#evictionCutoff)
      return 'evict';
    const now = this.#clock.now();
    return isRecent(now.wall - lastUsed.wall) && isRecent(now.monotonic - lastUsed.monotonic)
      ? 'use'
      : 'check';
  }

  now(): Instant {
    return this.#clock.now();
  }

  /** A `pg.Pool`, or a pool that emitted `connect` while the record listened, gives every client it opens since a record, so a client without one was last used before the record existed, and so before any cutoff. */
  #predatesRecord(): boolean {
    return this.#emitsConnect && this.#evictionCutoff !== undefined;
  }

  recordFailedCheck(startedAt: Instant): void {
    this.#evictionCutoff = Math.max(
      this.#evictionCutoff ?? startedAt.monotonic,
      startedAt.monotonic,
    );
  }
}

function isRecent(idleMillis: number): boolean {
  return idleMillis >= 0 && idleMillis < livenessCheckLimits.checkAfterIdleMillis;
}

const records = new WeakMap<PoolEvents, PoolLastUse>();

/** The record of when each client of `pool` was last used. One per pool, however many drivers share it. */
export function poolLastUse(pool: PoolEvents, clock: Clock = systemClock): PoolLastUse {
  let record = records.get(pool);
  if (record === undefined) {
    record = new PoolLastUseRecord(pool, clock);
    records.set(pool, record);
  }
  return record;
}
