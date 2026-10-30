import { APP_SPACE_ID, DEFAULT_DATABASE_POLICIES } from '@internal/framework-components/control';
import type { SqlControlDriverInstance } from '@internal/sql-contract/types';
import { describe, expect, it } from 'vitest';
import type { SqlControlAdapter } from '../src/core/control-adapter';
import { createSqlFamilyInstance } from '../src/core/control-instance';
import { buildContract, FIXTURE_HASH, makeStack } from './control-instance-stack.helpers';

interface StoredMarker {
  readonly storageHash: string;
  readonly profileHash: string;
  readonly meta?: Record<string, unknown>;
}

const EXT_SPACE_ID = 'pgvector';
const EXT_HASH = 'e'.repeat(64);

/**
 * An adapter over an in-memory marker table whose transaction restores the
 * table when the callback throws, so a test can tell committed writes from
 * rolled-back ones.
 */
function createMarkerStore(
  initial: Record<string, StoredMarker>,
  options: {
    readonly casLosesOn?: string;
    readonly bootstrapSql?: string;
    readonly holdsMarkerLockOutsideTransaction?: boolean;
  } = {},
) {
  let markers = new Map(Object.entries(initial));
  const events: string[] = [];
  const adapter = {
    familyId: 'sql',
    targetId: 'postgres',
    markerLocation: 'stub_marker',
    bootstrapSignMarkerQueries: () => (options.bootstrapSql === undefined ? [] : [{}]),
    async lowerToExecuteRequest() {
      return { sql: options.bootstrapSql, params: [] };
    },
    async withTransaction<T>(_driver: unknown, fn: () => Promise<T>): Promise<T> {
      const snapshot = new Map(markers);
      events.push('BEGIN');
      try {
        const result = await fn();
        events.push('COMMIT');
        return result;
      } catch (error) {
        markers = snapshot;
        events.push('ROLLBACK');
        throw error;
      }
    },
    async lockMarker() {
      events.push('lock');
    },
    ...(options.holdsMarkerLockOutsideTransaction === true
      ? {
          async holdMarkerLock<T>(_driver: unknown, work: () => Promise<T>): Promise<T> {
            events.push('hold lock');
            try {
              return await work();
            } finally {
              events.push('release lock');
            }
          },
        }
      : {}),
    async readMarker(_driver: unknown, space: string) {
      const stored = markers.get(space);
      return stored === undefined
        ? null
        : { meta: {}, ...stored, contractJson: null, updatedAt: new Date(), invariants: [] };
    },
    async insertMarker(_driver: unknown, space: string, destination: StoredMarker) {
      events.push(`insert ${space}`);
      markers.set(space, {
        storageHash: destination.storageHash,
        profileHash: destination.profileHash,
      });
    },
    async updateMarker(
      _driver: unknown,
      space: string,
      expectedFrom: string,
      destination: StoredMarker,
    ) {
      events.push(`update ${space}`);
      if (space === options.casLosesOn) {
        markers.set(space, { storageHash: 'moved-mid-write', profileHash: 'moved-profile' });
        return false;
      }
      if (markers.get(space)?.storageHash !== expectedFrom) {
        return false;
      }
      markers.set(space, {
        storageHash: destination.storageHash,
        profileHash: destination.profileHash,
      });
      return true;
    },
  };
  return {
    instance: createSqlFamilyInstance(
      makeStack({
        createAdapter: () =>
          // The stub implements only the marker surface signSpaces touches.
          adapter as unknown as SqlControlAdapter<string>,
      }),
    ),
    events,
    driver: {
      async query(sql: string) {
        events.push(sql);
        return { rows: [] };
      },
    } as unknown as SqlControlDriverInstance<string>,
    markers: () => Object.fromEntries(markers),
  };
}

const driver = {} as SqlControlDriverInstance<string>;
const appContract = buildContract();
const extContract = buildContract({ storageHash: EXT_HASH, profileHash: 'ext-profile' });
const appHashes = { storageHash: FIXTURE_HASH, profileHash: 'fixture-profile-v1' };

describe('sql family markerLocation', () => {
  it('names the marker location its control adapter names', () => {
    expect(createMarkerStore({}).instance.markerLocation).toBe('stub_marker');
  });
});

describe('sql family signSpaces', () => {
  it('writes the marker of every space in one transaction', async () => {
    const store = createMarkerStore({
      [EXT_SPACE_ID]: { storageHash: 'old-ext', profileHash: 'old-ext-profile' },
    });

    const signatures = await store.instance.signSpaces({
      driver,
      spaces: [
        { space: APP_SPACE_ID, contract: appContract, expected: null },
        {
          space: EXT_SPACE_ID,
          contract: extContract,
          expected: { storageHash: 'old-ext', profileHash: 'old-ext-profile' },
        },
      ],
    });

    expect(signatures).toEqual([
      { status: 'created', space: APP_SPACE_ID, contract: appHashes },
      {
        status: 'updated',
        space: EXT_SPACE_ID,
        contract: { storageHash: EXT_HASH, profileHash: 'ext-profile' },
        previous: { storageHash: 'old-ext', profileHash: 'old-ext-profile' },
      },
    ]);
    expect(store.events).toEqual([
      'BEGIN',
      'lock',
      'insert app',
      `update ${EXT_SPACE_ID}`,
      'COMMIT',
    ]);
    expect(store.markers()).toEqual({
      [APP_SPACE_ID]: { storageHash: FIXTURE_HASH, profileHash: 'fixture-profile-v1' },
      [EXT_SPACE_ID]: { storageHash: EXT_HASH, profileHash: 'ext-profile' },
    });
  });

  it('leaves a marker that already holds the contract hashes unchanged', async () => {
    const store = createMarkerStore({
      [APP_SPACE_ID]: { storageHash: FIXTURE_HASH, profileHash: 'fixture-profile-v1' },
    });

    const signatures = await store.instance.signSpaces({
      driver,
      spaces: [{ space: APP_SPACE_ID, contract: appContract, expected: appHashes }],
    });

    expect(signatures).toEqual([{ status: 'unchanged', space: APP_SPACE_ID, contract: appHashes }]);
    expect(store.events).toEqual(['BEGIN', 'lock', 'COMMIT']);
  });

  it('reports a space that loses the compare-and-swap as a conflict, and signs the other spaces', async () => {
    const store = createMarkerStore(
      {
        [APP_SPACE_ID]: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        [EXT_SPACE_ID]: { storageHash: 'old-ext', profileHash: 'old-ext-profile' },
      },
      { casLosesOn: EXT_SPACE_ID },
    );

    const signatures = await store.instance.signSpaces({
      driver,
      spaces: [
        {
          space: APP_SPACE_ID,
          contract: appContract,
          expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        },
        {
          space: EXT_SPACE_ID,
          contract: extContract,
          expected: { storageHash: 'old-ext', profileHash: 'old-ext-profile' },
        },
      ],
    });

    expect(signatures).toEqual([
      {
        status: 'updated',
        space: APP_SPACE_ID,
        contract: appHashes,
        previous: { storageHash: 'old-app', profileHash: 'old-app-profile' },
      },
      {
        status: 'conflict',
        reason: 'storageHash',
        space: EXT_SPACE_ID,
        contract: { storageHash: EXT_HASH, profileHash: 'ext-profile' },
        expected: { storageHash: 'old-ext', profileHash: 'old-ext-profile' },
        found: { storageHash: 'moved-mid-write', profileHash: 'moved-profile' },
      },
    ]);
    expect(store.events).toEqual([
      'BEGIN',
      'lock',
      'update app',
      `update ${EXT_SPACE_ID}`,
      'COMMIT',
    ]);
    expect(store.markers()).toEqual({
      [APP_SPACE_ID]: { storageHash: FIXTURE_HASH, profileHash: 'fixture-profile-v1' },
      [EXT_SPACE_ID]: { storageHash: 'moved-mid-write', profileHash: 'moved-profile' },
    });
  });

  it('leaves a marker that changed after verification as it was, and signs the other spaces', async () => {
    const store = createMarkerStore({
      [APP_SPACE_ID]: { storageHash: 'moved-by-migrate', profileHash: 'moved-profile' },
    });

    const signatures = await store.instance.signSpaces({
      driver,
      spaces: [
        { space: EXT_SPACE_ID, contract: extContract, expected: null },
        {
          space: APP_SPACE_ID,
          contract: appContract,
          expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        },
      ],
    });

    expect(signatures).toEqual([
      {
        status: 'created',
        space: EXT_SPACE_ID,
        contract: { storageHash: EXT_HASH, profileHash: 'ext-profile' },
      },
      {
        status: 'conflict',
        reason: 'storageHash',
        space: APP_SPACE_ID,
        contract: appHashes,
        expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        found: { storageHash: 'moved-by-migrate', profileHash: 'moved-profile' },
      },
    ]);
    expect(store.events).toEqual(['BEGIN', 'lock', `insert ${EXT_SPACE_ID}`, 'COMMIT']);
    expect(store.markers()).toEqual({
      [APP_SPACE_ID]: { storageHash: 'moved-by-migrate', profileHash: 'moved-profile' },
      [EXT_SPACE_ID]: { storageHash: EXT_HASH, profileHash: 'ext-profile' },
    });
  });

  it('signs nothing when the policies changed after the check, and reports them on the application space', async () => {
    const moved = {
      storageHash: 'old-app',
      profileHash: 'old-app-profile',
      meta: { policies: { change: ['migrate'] } },
    };
    const store = createMarkerStore({ [APP_SPACE_ID]: moved });

    const signatures = await store.instance.signSpaces({
      driver,
      spaces: [
        { space: EXT_SPACE_ID, contract: extContract, expected: null },
        {
          space: APP_SPACE_ID,
          contract: appContract,
          expected: { storageHash: 'old-app', profileHash: 'old-app-profile' },
        },
      ],
      expectedDatabasePolicies: DEFAULT_DATABASE_POLICIES,
    });

    expect(signatures).toEqual([
      {
        status: 'conflict',
        reason: 'databasePolicies',
        space: APP_SPACE_ID,
        contract: appHashes,
        checked: DEFAULT_DATABASE_POLICIES,
        comparison: {
          kind: 'moved',
          found: { ...DEFAULT_DATABASE_POLICIES, change: ['migrate'] },
          differences: [
            { setting: 'change', declared: ['migrate', 'reconcile'], inForce: ['migrate'] },
          ],
        },
      },
    ]);
    expect(store.markers()).toEqual({ [APP_SPACE_ID]: moved });
  });

  it('reports a marker written after a verification that found none as a conflict', async () => {
    const store = createMarkerStore({
      [APP_SPACE_ID]: { storageHash: 'written-by-migrate', profileHash: 'migrate-profile' },
    });

    const signatures = await store.instance.signSpaces({
      driver,
      spaces: [{ space: APP_SPACE_ID, contract: appContract, expected: null }],
    });

    expect(signatures).toEqual([
      {
        status: 'conflict',
        reason: 'storageHash',
        space: APP_SPACE_ID,
        contract: appHashes,
        expected: null,
        found: { storageHash: 'written-by-migrate', profileHash: 'migrate-profile' },
      },
    ]);
    expect(store.markers()).toEqual({
      [APP_SPACE_ID]: { storageHash: 'written-by-migrate', profileHash: 'migrate-profile' },
    });
  });

  it('takes the lock and creates the marker table inside the transaction that writes markers', async () => {
    const store = createMarkerStore({}, { bootstrapSql: 'CREATE TABLE IF NOT EXISTS marker' });

    await store.instance.signSpaces({
      driver: store.driver,
      spaces: [{ space: APP_SPACE_ID, contract: appContract, expected: null }],
    });

    expect(store.events).toEqual([
      'BEGIN',
      'lock',
      'CREATE TABLE IF NOT EXISTS marker',
      'insert app',
      'COMMIT',
    ]);
  });

  it('creates the marker table under a lock held outside the transaction when the adapter holds one', async () => {
    const store = createMarkerStore(
      {},
      {
        bootstrapSql: 'CREATE TABLE IF NOT EXISTS marker',
        holdsMarkerLockOutsideTransaction: true,
      },
    );

    await store.instance.signSpaces({
      driver: store.driver,
      spaces: [{ space: APP_SPACE_ID, contract: appContract, expected: null }],
    });

    expect(store.events).toEqual([
      'hold lock',
      'CREATE TABLE IF NOT EXISTS marker',
      'BEGIN',
      'insert app',
      'COMMIT',
      'release lock',
    ]);
  });

  it('opens no transaction when there is no space to sign', async () => {
    const store = createMarkerStore({});

    expect(await store.instance.signSpaces({ driver, spaces: [] })).toEqual([]);
    expect(store.events).toEqual([]);
  });
});
