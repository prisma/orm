import type { QueryConfig } from 'pg';

/** How long a pooled client may sit idle and still be used unchecked, and how long its liveness check may take. */
export const livenessCheckSettings = {
  checkAfterIdleMillis: 1000,
  timeoutMillis: 5000,
};

/** A statement config with pg's per-statement time limit, which `@types/pg` leaves out. */
interface TimedQueryConfig extends QueryConfig {
  readonly query_timeout: number;
}

/** `statement` with a time limit of its own; the client's other statements keep theirs. */
export function timedStatement(statement: QueryConfig, timeLimitMillis: number): TimedQueryConfig {
  return { ...statement, query_timeout: timeLimitMillis };
}

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

export interface PoolClientUse {
  verdict(client: object): CheckoutVerdict;
  now(): Instant;
  /** Marks every client last used before `startedAt`, when a liveness check that started then failed, for eviction. */
  recordFailedCheck(startedAt: Instant): void;
}

interface PoolUseEvents {
  on(event: 'connect', listener: (client: object) => void): unknown;
  on(event: 'release', listener: (error: unknown, client: object) => void): unknown;
}

class PoolClientUseRecord implements PoolClientUse {
  readonly #clock: Clock;
  readonly #lastUsed = new WeakMap<object, Instant>();
  #evictBefore: number | undefined;

  constructor(pool: PoolUseEvents, clock: Clock) {
    this.#clock = clock;
    pool.on('connect', (client) => this.#lastUsed.set(client, clock.now()));
    pool.on('release', (_error, client) => this.#lastUsed.set(client, clock.now()));
  }

  verdict(client: object): CheckoutVerdict {
    const lastUsed = this.#lastUsed.get(client);
    if (lastUsed === undefined) return this.#evictBefore === undefined ? 'check' : 'evict';
    if (this.#evictBefore !== undefined && lastUsed.monotonic < this.#evictBefore) return 'evict';
    const now = this.#clock.now();
    return isRecent(now.wall - lastUsed.wall) && isRecent(now.monotonic - lastUsed.monotonic)
      ? 'use'
      : 'check';
  }

  now(): Instant {
    return this.#clock.now();
  }

  recordFailedCheck(startedAt: Instant): void {
    this.#evictBefore = Math.max(this.#evictBefore ?? startedAt.monotonic, startedAt.monotonic);
  }
}

function isRecent(idleMillis: number): boolean {
  return idleMillis >= 0 && idleMillis < livenessCheckSettings.checkAfterIdleMillis;
}

const records = new WeakMap<PoolUseEvents, PoolClientUse>();

/** The record of when each client of `pool` was last used. One per pool, however many drivers share it. */
export function poolClientUse(pool: PoolUseEvents, clock: Clock = systemClock): PoolClientUse {
  let record = records.get(pool);
  if (record === undefined) {
    record = new PoolClientUseRecord(pool, clock);
    records.set(pool, record);
  }
  return record;
}
