import { APP_SPACE_ID } from '@internal/framework-components/control';
import { notOk } from '@internal/utils/result';
import { describe, expect, it } from 'vitest';
import {
  createFixtureControlClient,
  FIXTURE_STORAGE_HASH,
  FIXTURE_TARGET_ID,
  type FixtureControlClient,
} from '../../../src/control-api/testing/fixture-client';

describe('createFixtureControlClient', () => {
  it('serves realistic default fixtures for every operation', async () => {
    const client = createFixtureControlClient();
    await client.connect('postgres://fixture');

    const verify = await client.verify({ contract: {} });
    expect(verify).toMatchObject({
      ok: true,
      contract: { storageHash: FIXTURE_STORAGE_HASH },
      target: { expected: FIXTURE_TARGET_ID },
    });

    const schemaVerify = await client.schemaVerify({ contract: {} });
    expect(schemaVerify.ok).toBe(true);
    expect(schemaVerify.schema.issues).toEqual([]);

    const sign = await client.sign({ contract: {} });
    expect(sign.marker).toEqual({ created: true, updated: false });

    const dbInit = await client.dbInit({
      contract: {},
      mode: 'apply',
      migrationsDir: 'migrations',
    });
    expect(dbInit.assertOk()).toMatchObject({
      mode: 'apply',
      destination: { storageHash: FIXTURE_STORAGE_HASH },
    });

    const dbUpdate = await client.dbUpdate({
      contract: {},
      mode: 'plan',
      migrationsDir: 'migrations',
    });
    expect(dbUpdate.ok).toBe(true);

    const dbVerify = await client.dbVerify({
      contract: {} as never,
      migrationsDir: 'migrations',
      strict: false,
      skipSchema: false,
      skipMarker: false,
    });
    expect(dbVerify.assertOk().appSpaceId).toBe(APP_SPACE_ID);

    const marker = await client.readMarker();
    expect(marker?.storageHash).toBe(FIXTURE_STORAGE_HASH);

    const markers = await client.readAllMarkers();
    expect(markers.get(APP_SPACE_ID)?.storageHash).toBe(FIXTURE_STORAGE_HASH);

    const ledger = await client.readLedger();
    expect(ledger).toHaveLength(1);
    expect(ledger[0]).toMatchObject({ space: APP_SPACE_ID, to: FIXTURE_STORAGE_HASH });

    const migrate = await client.migrate({ contract: {}, migrationsDir: 'migrations' });
    expect(migrate.assertOk().markerHash).toBe(FIXTURE_STORAGE_HASH);

    expect(await client.introspect()).toBeDefined();
    expect(client.toSchemaView({})).toBeUndefined();
    expect(client.inferPslContract({})).toBeUndefined();
    expect(client.printPslContract({})).toBeUndefined();
    expect(client.getPslBlockDescriptors()).toEqual({});
    expect(client.toOperationPreview([])).toBeUndefined();

    const emit = await client.emit({
      contractConfig: {
        source: { load: async () => notOk({ summary: '', diagnostics: [] }) },
        output: 'contract.json',
      },
    });
    expect(emit.assertOk().storageHash).toBe(FIXTURE_STORAGE_HASH);

    await client.close();
  });

  it('lets tests override individual operation fixtures', async () => {
    const failure = notOk({
      code: 'PLANNING_FAILED' as const,
      summary: 'planner exploded',
      why: undefined,
      conflicts: undefined,
      meta: undefined,
    });
    const client = createFixtureControlClient({
      dbInit: failure,
      readMarker: null,
    });
    await client.connect('postgres://fixture');

    const dbInit = await client.dbInit({ contract: {}, mode: 'plan', migrationsDir: 'migrations' });
    expect(dbInit.assertNotOk().summary).toBe('planner exploded');
    expect(await client.readMarker()).toBeNull();

    // Non-overridden operations keep their defaults.
    expect((await client.verify({ contract: {} })).ok).toBe(true);
  });

  it('records every operation call with its options for assertions', async () => {
    const client = createFixtureControlClient();
    await client.connect('postgres://fixture');

    await client.dbInit({ contract: {}, mode: 'plan', migrationsDir: 'moves' });
    await client.readLedger('app');

    expect(client.calls).toEqual([
      { operation: 'init', options: undefined },
      { operation: 'connect', options: 'postgres://fixture' },
      {
        operation: 'dbInit',
        options: expect.objectContaining({ mode: 'plan', migrationsDir: 'moves' }),
      },
      { operation: 'readLedger', options: 'app' },
    ]);
  });

  it('tracks connection state without touching a database', async () => {
    const client = createFixtureControlClient();
    expect(client.connected).toBe(false);
    await client.connect('postgres://fixture');
    expect(client.connected).toBe(true);
    await client.close();
    expect(client.connected).toBe(false);
  });

  it('initializes once, from connect or from an explicit init', async () => {
    const client = createFixtureControlClient();
    client.init();
    client.init();
    await client.connect('postgres://fixture');

    expect(client.calls).toEqual([
      { operation: 'init', options: undefined },
      { operation: 'connect', options: 'postgres://fixture' },
    ]);
  });

  describe('operations that the real client runs against a driver', () => {
    const requireConnection: ReadonlyArray<
      [string, (c: FixtureControlClient) => Promise<unknown>]
    > = [
      ['verify', (c) => c.verify({ contract: {} })],
      ['schemaVerify', (c) => c.schemaVerify({ contract: {} })],
      ['sign', (c) => c.sign({ contract: {} })],
      ['dbInit', (c) => c.dbInit({ contract: {}, mode: 'plan', migrationsDir: 'migrations' })],
      ['dbUpdate', (c) => c.dbUpdate({ contract: {}, mode: 'plan', migrationsDir: 'migrations' })],
      [
        'dbVerify',
        (c) =>
          c.dbVerify({
            contract: {} as never,
            migrationsDir: 'migrations',
            strict: false,
            skipSchema: false,
            skipMarker: false,
          }),
      ],
      ['readMarker', (c) => c.readMarker()],
      ['readAllMarkers', (c) => c.readAllMarkers()],
      ['readLedger', (c) => c.readLedger()],
      ['migrate', (c) => c.migrate({ contract: {}, migrationsDir: 'migrations' })],
      ['introspect', (c) => c.introspect()],
    ];

    it.each(requireConnection)('%s rejects before connect()', async (_name, run) => {
      const client = createFixtureControlClient();

      await expect(run(client)).rejects.toMatchObject({
        name: 'CliStructuredError',
        code: 'DRIVER.NOT_CONNECTED',
      });
      expect(client.calls).toEqual([]);
    });

    it.each(requireConnection)('%s rejects again after close()', async (_name, run) => {
      const client = createFixtureControlClient();
      await client.connect('postgres://fixture');
      await client.close();

      await expect(run(client)).rejects.toMatchObject({ code: 'DRIVER.NOT_CONNECTED' });
    });

    it('connects from an operation-level connection, as the real client does', async () => {
      const client = createFixtureControlClient();

      const verified = await client.dbVerify({
        contract: {} as never,
        migrationsDir: 'migrations',
        strict: false,
        skipSchema: false,
        skipMarker: false,
        connection: 'postgres://fixture',
      });

      expect(verified.assertOk()).toBeDefined();
      expect(client.connected).toBe(true);
      expect(client.calls.map((call) => call.operation)).toEqual(['init', 'connect', 'dbVerify']);
    });
  });

  it('serves the driver-free operations without a connection', async () => {
    const client = createFixtureControlClient();

    expect(client.toSchemaView({})).toBeUndefined();
    expect(client.inferPslContract({})).toBeUndefined();
    expect(client.printPslContract({})).toBeUndefined();
    expect(client.getPslBlockDescriptors()).toEqual({});
    expect(client.toOperationPreview([])).toBeUndefined();
    const emit = await client.emit({
      contractConfig: {
        source: { load: async () => notOk({ summary: '', diagnostics: [] }) },
        output: 'contract.json',
      },
    });

    expect(emit.assertOk().storageHash).toBe(FIXTURE_STORAGE_HASH);
  });
});
