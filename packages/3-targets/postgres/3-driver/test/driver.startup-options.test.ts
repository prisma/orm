import { type StartupParameterRecorder, startStartupParameterRecorder } from '@repo/test-utils';
import pg from 'pg';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import postgresControlDriverDescriptor from '../src/exports/control';
import postgresRuntimeDriverDescriptor from '../src/exports/runtime';
import { createBoundDriverFromBinding } from '../src/postgres-driver';
import { createPgPool } from '../src/session-settings';
import { queryRows } from './sql-queryable-test-utils';

const SESSION_SETTINGS = { DateStyle: 'ISO', lc_monetary: 'C' } as const;

const URL_OPTIONS = 'options=-c%20search_path%3Dreports%20-c%20DateStyle%3DGerman';

describe('the startup options of a connection', () => {
  let recorder: StartupParameterRecorder;

  beforeEach(async () => {
    recorder = await startStartupParameterRecorder();
  });

  afterEach(async () => {
    await recorder.close();
  });

  it('set the session settings, after the options the URL gives, on a runtime connection Prisma opens', async () => {
    const driver = createBoundDriverFromBinding(
      { kind: 'url', url: `${recorder.url}?${URL_OPTIONS}` },
      undefined,
      { sessionSettings: SESSION_SETTINGS },
    );
    await queryRows(driver, 'select 1').catch(() => undefined);
    await driver.close().catch(() => undefined);

    expect((await recorder.next())['options']).toBe(
      '-c search_path=reports -c DateStyle=German -c DateStyle=ISO -c lc_monetary=C',
    );
  });

  it('set the session settings a runtime driver is created with on the connections it opens', async () => {
    const driver = postgresRuntimeDriverDescriptor.create(undefined, SESSION_SETTINGS);
    await driver.connect({ kind: 'url', url: recorder.url });
    await queryRows(driver, 'select 1').catch(() => undefined);
    await driver.close().catch(() => undefined);

    expect((await recorder.next())['options']).toBe('-c DateStyle=ISO -c lc_monetary=C');
  });

  it('set the session settings on a control connection Prisma opens', async () => {
    await postgresControlDriverDescriptor
      .create(recorder.url, { sessionSettings: SESSION_SETTINGS })
      .catch(() => undefined);

    expect((await recorder.next())['options']).toBe('-c DateStyle=ISO -c lc_monetary=C');
  });

  it('are left as they are on a client the application supplies', async () => {
    const driver = createBoundDriverFromBinding(
      {
        kind: 'pgClient',
        client: new pg.Client({ connectionString: `${recorder.url}?${URL_OPTIONS}` }),
        ownedByDriver: false,
      },
      undefined,
      { sessionSettings: SESSION_SETTINGS },
    );
    await queryRows(driver, 'select 1').catch(() => undefined);
    await driver.close().catch(() => undefined);

    expect((await recorder.next())['options']).toBe('-c search_path=reports -c DateStyle=German');
  });

  it('read PGOPTIONS when a pool opens each connection, not once when the pool is made', async () => {
    const pool = createPgPool({ connectionString: recorder.url }, SESSION_SETTINGS);
    vi.stubEnv('PGOPTIONS', '-c search_path=later');
    try {
      await pool.connect().catch(() => undefined);
      expect((await recorder.next())['options']).toBe(
        '-c search_path=later -c DateStyle=ISO -c lc_monetary=C',
      );
    } finally {
      vi.unstubAllEnvs();
      await pool.end().catch(() => undefined);
    }
  });
});
