import { isStructuredError } from '@internal/utils/structured-error';
import { describe, expect, it, vi } from 'vitest';
import {
  compareVersionPrefix,
  type ProbeOutcome,
  type ProbeOverrides,
  parsePostgresVersion,
  probeServerVersion,
} from '../../../src/commands/init/probe-db';

// ---------------------------------------------------------------------------
// FR8.3 — version comparator + parser unit tests
// ---------------------------------------------------------------------------

describe('compareVersionPrefix (FR8.3)', () => {
  it('treats "14" as equal to "14.0" up to the shorter length', () => {
    expect(compareVersionPrefix('14', '14.0')).toBe(0);
    expect(compareVersionPrefix('14.0', '14')).toBe(0);
  });

  it('returns negative when the left version is older', () => {
    expect(compareVersionPrefix('13', '14')).toBeLessThan(0);
    expect(compareVersionPrefix('14.1', '14.2')).toBeLessThan(0);
    expect(compareVersionPrefix('5.0.10', '6.0')).toBeLessThan(0);
  });

  it('returns positive when the left version is newer', () => {
    expect(compareVersionPrefix('15', '14')).toBeGreaterThan(0);
    expect(compareVersionPrefix('14.10', '14.2')).toBeGreaterThan(0);
    expect(compareVersionPrefix('7.0', '6.0')).toBeGreaterThan(0);
  });

  it('treats a missing trailing component as 0 in both directions (prefix-length mismatch)', () => {
    // The previous implementation iterated over `Math.min(...)` and so
    // silently accepted "14" against a configured minimum of "14.1";
    // we now extend the shorter prefix with zeroes so the user sees
    // the upgrade requirement.
    expect(compareVersionPrefix('14', '14.1')).toBeLessThan(0);
    expect(compareVersionPrefix('14.1', '14')).toBeGreaterThan(0);
    expect(compareVersionPrefix('14', '14')).toBe(0);
    expect(compareVersionPrefix('6', '6.0.1')).toBeLessThan(0);
    expect(compareVersionPrefix('6.0.1', '6')).toBeGreaterThan(0);
  });
});

describe('parsePostgresVersion (FR8.3)', () => {
  it('extracts the version from a typical SELECT version() row', () => {
    expect(
      parsePostgresVersion('PostgreSQL 14.10 on x86_64-pc-linux-gnu, compiled by gcc 11.4.0'),
    ).toBe('14.10');
  });

  it('falls back to the major when no minor is present', () => {
    expect(parsePostgresVersion('PostgreSQL 16 on aarch64-apple-darwin')).toBe('16');
  });

  it('throws on a row that does not start with PostgreSQL', () => {
    expect(() => parsePostgresVersion('NotPostgres 1.0')).toThrow(/Could not parse/);
  });

  it('raises CLI.INIT_PROBE_FAILED on an unparseable version row', () => {
    let thrown: unknown;
    try {
      parsePostgresVersion('NotPostgres 1.0');
    } catch (error) {
      thrown = error;
    }
    expect(isStructuredError(thrown)).toBe(true);
    expect(thrown).toMatchObject({ code: 'CLI.INIT_PROBE_FAILED' });
  });
});

// ---------------------------------------------------------------------------
// FR8.3 — probeServerVersion outcome surface
// ---------------------------------------------------------------------------

describe('probeServerVersion (FR8.3)', () => {
  it('returns no-database-url when DATABASE_URL is unset', async () => {
    const outcome = await probeServerVersion(
      { baseDir: '/tmp', target: 'postgres', databaseUrl: undefined, minVersion: '14' },
      // The probe must not even attempt to connect when DATABASE_URL is absent.
      // A test stub here would be a regression of the offline-by-default
      // contract (NFR9) — fail fast if it's invoked.
      {
        probePostgres: () => {
          throw new Error('probe must not be invoked without DATABASE_URL');
        },
      },
    );

    expect(outcome.kind).toBe('no-database-url');
    expect(outcome.minVersion).toBe('14');
  });

  it('returns no-database-url for a whitespace-only DATABASE_URL', async () => {
    const outcome = await probeServerVersion(
      { baseDir: '/tmp', target: 'postgres', databaseUrl: '   ', minVersion: '14' },
      {
        probePostgres: () => {
          throw new Error('probe must not be invoked for whitespace URL');
        },
      },
    );

    expect(outcome.kind).toBe('no-database-url');
  });

  it('returns ok with the parsed server version when the server meets minimum', async () => {
    const outcome = await probeServerVersion(
      {
        baseDir: '/tmp',
        target: 'postgres',
        databaseUrl: 'postgres://localhost:5432/db',
        minVersion: '14',
      },
      { probePostgres: async () => ({ serverVersion: '15.2' }) },
    );

    expect(outcome).toEqual<ProbeOutcome>({
      kind: 'ok',
      serverVersion: '15.2',
      minVersion: '14',
      meetsMinimum: true,
      message: '--probe-db: server reports version 15.2 (>= 14).',
    });
  });

  it('returns below-minimum when the server is older than the declared minimum', async () => {
    const outcome = await probeServerVersion(
      {
        baseDir: '/tmp',
        target: 'mongo',
        databaseUrl: 'mongodb://localhost:27017/db',
        minVersion: '6.0',
      },
      { probeMongo: async () => ({ serverVersion: '5.0.10' }) },
    );

    expect(outcome.kind).toBe('below-minimum');
    if (outcome.kind === 'below-minimum') {
      expect(outcome.serverVersion).toBe('5.0.10');
      expect(outcome.minVersion).toBe('6.0');
      expect(outcome.message).toContain('below the declared minimum');
    }
  });

  it('returns connection-failed and redacts URL secrets when the driver throws', async () => {
    const outcome = await probeServerVersion(
      {
        baseDir: '/tmp',
        target: 'postgres',
        databaseUrl: 'postgres://alice:hunter2@localhost:5432/db',
        minVersion: '14',
      },
      {
        probePostgres: () => {
          throw new Error('connect ECONNREFUSED postgres://alice:hunter2@localhost:5432');
        },
      },
    );

    expect(outcome).toMatchObject({
      kind: 'connection-failed',
      cause: 'connect ECONNREFUSED postgres://****:****@localhost:5432',
    });
  });

  it('returns driver-missing when require() cannot resolve the peer driver', async () => {
    const outcome = await probeServerVersion(
      {
        baseDir: '/tmp/no-such-project',
        target: 'postgres',
        databaseUrl: 'postgres://localhost:5432/db',
        minVersion: '14',
      },
      {
        requireFromBaseDir: () => {
          // Simulate a CJS resolution failure.
          throw new Error("Cannot find module 'pg'");
        },
      },
    );

    expect(outcome.kind).toBe('driver-missing');
    if (outcome.kind === 'driver-missing') {
      expect(outcome.cause).toContain('not installed');
    }
  });

  it('mongo path uses the mongo override when target=mongo', async () => {
    const probePostgres = vi.fn<NonNullable<ProbeOverrides['probePostgres']>>();
    const probeMongo = vi.fn(async () => ({ serverVersion: '7.0.1' }));

    const outcome = await probeServerVersion(
      {
        baseDir: '/tmp',
        target: 'mongo',
        databaseUrl: 'mongodb://localhost:27017/db',
        minVersion: '6.0',
      },
      { probePostgres, probeMongo },
    );

    expect(probePostgres).not.toHaveBeenCalled();
    expect(probeMongo).toHaveBeenCalledTimes(1);
    expect(outcome.kind).toBe('ok');
  });
});

describe('defaultProbePostgres idle connection errors', () => {
  it('attaches an error listener so a dropped connection cannot crash the process', async () => {
    const clients: FakeProbeClient[] = [];
    class FakeProbeClient {
      readonly listeners = new Map<string, (err: Error) => void>();
      constructor(_cfg: { connectionString: string }) {
        clients.push(this);
      }
      on(event: string, listener: (err: Error) => void): this {
        this.listeners.set(event, listener);
        return this;
      }
      async connect(): Promise<void> {}
      async query(): Promise<{ rows: Array<{ version: string }> }> {
        return { rows: [{ version: 'PostgreSQL 16.1 on x86_64-pc-linux-gnu' }] };
      }
      async end(): Promise<void> {}
    }

    const outcome = await probeServerVersion(
      {
        baseDir: '/tmp',
        target: 'postgres',
        databaseUrl: 'postgres://localhost:5432/db',
        minVersion: '14',
      },
      { requireFromBaseDir: () => ({ Client: FakeProbeClient }) },
    );

    expect(outcome.kind).toBe('ok');
    expect(clients).toHaveLength(1);
    const errorListener = clients[0]?.listeners.get('error');
    expect(errorListener).toBeDefined();
    expect(() => errorListener?.(new Error('connection terminated unexpectedly'))).not.toThrow();
  });

  it('ends the client when connect() rejects', async () => {
    const endSpy = vi.fn(async () => {});
    class FailingConnectClient {
      constructor(_cfg: { connectionString: string }) {}
      on(): this {
        return this;
      }
      async connect(): Promise<void> {
        throw new Error('password authentication failed');
      }
      async query(): Promise<never> {
        throw new Error('query must not be reached');
      }
      end = endSpy;
    }

    const outcome = await probeServerVersion(
      {
        baseDir: '/tmp',
        target: 'postgres',
        databaseUrl: 'postgres://localhost:5432/db',
        minVersion: '14',
      },
      { requireFromBaseDir: () => ({ Client: FailingConnectClient }) },
    );

    expect(outcome.kind).toBe('connection-failed');
    expect(endSpy).toHaveBeenCalledTimes(1);
  });
});
