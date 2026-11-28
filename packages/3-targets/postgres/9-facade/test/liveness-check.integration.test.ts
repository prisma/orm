import { once } from 'node:events';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import postgres from '../src/exports/runtime';
import { contractFromJson } from '../src/exports/static';
import type { Contract } from './fixtures/generated/contract';
import contractJson from './fixtures/generated/contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

/** A TCP proxy in front of the database that can cut its connections to the database while their clients sit idle. */
interface ResettingProxy {
  readonly port: number;
  /** Cuts every open connection to the database; each client gets a TCP reset when it next writes. */
  resetOnNextWrite(): void;
  close(): Promise<void>;
}

async function startResettingProxy(target: {
  host: string;
  port: number;
}): Promise<ResettingProxy> {
  const upstreamOf = new Map<Socket, Socket>();
  const dead = new WeakSet<Socket>();
  const server: Server = createServer((downstream) => {
    const upstream = createConnection(target);
    upstreamOf.set(downstream, upstream);
    downstream.on('data', (chunk: Buffer) => {
      if (dead.has(downstream)) downstream.resetAndDestroy();
      else upstream.write(chunk);
    });
    upstream.on('data', (chunk: Buffer) => downstream.write(chunk));
    downstream.on('close', () => {
      upstreamOf.delete(downstream);
      upstream.destroy();
    });
    upstream.on('close', () => {
      if (!dead.has(downstream)) downstream.destroy();
    });
    for (const socket of [downstream, upstream]) socket.on('error', () => undefined);
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('proxy has no port');
  return {
    port: address.port,
    resetOnNextWrite() {
      for (const [downstream, upstream] of upstreamOf) {
        dead.add(downstream);
        upstream.destroy();
      }
    },
    close: async () => {
      for (const downstream of upstreamOf.keys()) downstream.destroy();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let proxy: ResettingProxy;
let url: string;
let closeDatabase: () => Promise<void>;

beforeEach(async () => {
  const database = await createDevDatabase();
  closeDatabase = () => database.close();
  const target = new URL(database.connectionString);
  proxy = await startResettingProxy({ host: target.hostname, port: Number(target.port) });
  target.host = `127.0.0.1:${proxy.port}`;
  url = target.toString();
}, timeouts.spinUpPpgDev);

afterEach(async () => {
  vi.useRealTimers();
  await proxy.close();
  await closeDatabase();
}, timeouts.spinUpPpgDev);

it(
  'replaces a pooled connection that died while idle, on the pool it creates for a url',
  async () => {
    const db = postgres({ contract, url, verifyMarker: false, poolOptions: { max: 1 } });
    const readOne = () =>
      db.query(db.raw.sql`SELECT 1 AS one`.returnsRow({ one: 'pg/int4@1' }).build()).toArray();
    try {
      await readOne();
      proxy.resetOnNextWrite();
      vi.useFakeTimers({ toFake: ['Date'] });
      vi.setSystemTime(Date.now() + 60_000);

      expect(await readOne()).toEqual([{ one: 1 }]);
    } finally {
      await db.close();
    }
  },
  timeouts.spinUpPpgDev,
);
