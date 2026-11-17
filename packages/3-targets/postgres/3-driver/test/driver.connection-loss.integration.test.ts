import { once } from 'node:events';
import { createConnection, createServer, type Server, type Socket } from 'node:net';
import { SqlConnectionError } from '@internal/sql-errors';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client, Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import postgresControlDriverDescriptor from '../src/exports/control';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { queryRows } from './sql-queryable-test-utils';

/** A TCP proxy in front of the database that can cut every connection, now or on the next query. */
interface CuttingProxy {
  readonly port: number;
  cutNow(): void;
  cutOnNextQuery(): void;
  close(): Promise<void>;
}

async function startProxy(target: { host: string; port: number }): Promise<CuttingProxy> {
  const sockets = new Set<Socket>();
  let cutPending = false;
  const cutNow = () => {
    for (const socket of sockets) socket.destroy();
  };
  const server: Server = createServer((downstream) => {
    const upstream = createConnection(target);
    sockets.add(downstream);
    sockets.add(upstream);
    let startedUp = false;
    downstream.on('data', (chunk: Buffer) => {
      if (startedUp && cutPending) {
        cutPending = false;
        cutNow();
        return;
      }
      upstream.write(chunk);
    });
    upstream.on('data', (chunk: Buffer) => {
      if (chunk.includes(Buffer.from('Z'))) startedUp = true;
      downstream.write(chunk);
    });
    for (const socket of [downstream, upstream]) {
      socket.on('close', () => {
        sockets.delete(socket);
        downstream.destroy();
        upstream.destroy();
      });
      socket.on('error', () => undefined);
    }
  });
  server.listen(0, '127.0.0.1');
  await once(server, 'listening');
  const address = server.address();
  if (address === null || typeof address === 'string') throw new Error('proxy has no port');
  return {
    port: address.port,
    cutNow,
    cutOnNextQuery: () => {
      cutPending = true;
    },
    close: async () => {
      cutNow();
      await new Promise<void>((resolve) => server.close(() => resolve()));
    },
  };
}

let proxy: CuttingProxy;
let closeDatabase: () => Promise<void>;
let connectionString: string;

beforeEach(async () => {
  const database = await createDevDatabase();
  closeDatabase = () => database.close();
  const url = new URL(database.connectionString);
  proxy = await startProxy({ host: url.hostname, port: Number(url.port) });
  url.host = `127.0.0.1:${proxy.port}`;
  connectionString = url.toString();
}, timeouts.spinUpPpgDev);

afterEach(async () => {
  await proxy.close();
  await closeDatabase();
}, timeouts.spinUpPpgDev);

describe('a connection lost under real pg', () => {
  it('makes a direct client refuse the next use after it drops while idle', async () => {
    const client = new Client({ connectionString });
    client.on('error', () => undefined);
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client, ownedByDriver: true },
      { disabled: true },
    );
    await queryRows(driver, 'select 1');

    const ended = new Promise<void>((resolve) => client.once('end', () => resolve()));
    proxy.cutNow();
    await ended;

    expect(driver.state).toBe('closed');
    await expect(queryRows(driver, 'select 1')).rejects.toMatchObject({
      code: 'DRIVER.NOT_CONNECTED',
    });
  });

  it('classifies a direct client query cut mid-flight as a connection error', async () => {
    const client = new Client({ connectionString });
    client.on('error', () => undefined);
    const driver = createBoundDriverFromBinding(
      { kind: 'pgClient', client, ownedByDriver: true },
      { disabled: true },
    );
    await queryRows(driver, 'select 1');

    proxy.cutOnNextQuery();

    const error = await queryRows(driver, 'select 1').then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(SqlConnectionError);
    expect((error as { cause?: object }).cause).not.toHaveProperty('code');
  });

  it('classifies a pool client query cut mid-flight as a connection error', async () => {
    const pool = new Pool({ connectionString, max: 1 });
    const driver = createBoundDriverFromBinding(
      { kind: 'pgPool', pool, ownedByDriver: true },
      { disabled: true },
    );
    await queryRows(driver, 'select 1');

    proxy.cutOnNextQuery();

    const error = await queryRows(driver, 'select 1').then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(SqlConnectionError);
    expect((error as { cause?: object }).cause).not.toHaveProperty('code');
    await driver.close();
  });

  it('classifies a control driver query cut mid-flight as a connection error', async () => {
    const driver = await postgresControlDriverDescriptor.create(connectionString);
    await driver.query('select 1');

    proxy.cutOnNextQuery();

    const error = await driver.query('select 1').then(
      () => undefined,
      (reason: unknown) => reason,
    );
    expect(error).toBeInstanceOf(SqlConnectionError);
    expect((error as { cause?: object }).cause).not.toHaveProperty('code');
    await driver.close();
  });
});
