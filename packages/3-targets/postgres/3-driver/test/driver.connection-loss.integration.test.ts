import { SqlConnectionError } from '@internal/sql-errors';
import { createDevDatabase, timeouts } from '@repo/test-utils';
import { Client, Pool } from 'pg';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import postgresControlDriverDescriptor from '../src/exports/control';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import {
  type DyingConnectionsProxy,
  startDyingConnectionsProxy,
  targetOf,
  throughProxy,
} from './dying-connections-proxy';
import { queryRows } from './sql-queryable-test-utils';

let proxy: DyingConnectionsProxy;
let closeDatabase: () => Promise<void>;
let connectionString: string;

beforeEach(async () => {
  const database = await createDevDatabase();
  closeDatabase = () => database.close();
  proxy = await startDyingConnectionsProxy(targetOf(database.connectionString));
  connectionString = throughProxy(database.connectionString, proxy.port);
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
