import { EventEmitter } from 'node:events';
import type { Pool } from 'pg';
import { newDb } from 'pg-mem';

/**
 * A pg-mem pool that, as pg-pool does, emits `connect` for the client it hands out. pg-mem's own
 * pool emits nothing, so the driver would treat its client as one that sat idle for an unknown time.
 */
export function memPgPool(): Pool {
  const { Pool: MemPool } = newDb().adapters.createPg();
  const memPool = new MemPool();
  const events = new EventEmitter();
  const connect = memPool.connect.bind(memPool);
  return Object.assign(memPool, {
    on: events.on.bind(events),
    connect: async () => {
      const client = await connect();
      events.emit('connect', client);
      return client;
    },
  }) as unknown as Pool;
}
