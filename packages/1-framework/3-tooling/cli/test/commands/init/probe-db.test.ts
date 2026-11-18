import { describe, expect, it, vi } from 'vitest';
import type { InitProbeResult } from '../../../src/commands/init/init-contribution';
import {
  compareVersionPrefix,
  type ProbeContext,
  type ProbeOutcome,
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

// ---------------------------------------------------------------------------
// FR8.3 — probeServerVersion outcome surface
// ---------------------------------------------------------------------------

function probeContext(
  databaseUrl: string | undefined,
  probe: ((url: string) => Promise<InitProbeResult>) | undefined,
  minVersion = '14',
): ProbeContext {
  return {
    baseDir: '/tmp',
    databaseUrl,
    packageName: '@example/target',
    contribution: {
      serverRequirement: { minVersion, checkCommand: 'SELECT version()' },
      ...(probe === undefined ? {} : { probe }),
    },
  };
}

describe('probeServerVersion (FR8.3)', () => {
  it('returns no-database-url when DATABASE_URL is unset', async () => {
    // The probe must not even attempt to connect when DATABASE_URL is absent.
    // A test stub here would be a regression of the offline-by-default
    // contract (NFR9) — fail fast if it's invoked.
    const outcome = await probeServerVersion(
      probeContext(undefined, () => {
        throw new Error('probe must not be invoked without DATABASE_URL');
      }),
    );

    expect(outcome.kind).toBe('no-database-url');
    expect(outcome.minVersion).toBe('14');
  });

  it('returns no-database-url for a whitespace-only DATABASE_URL', async () => {
    const outcome = await probeServerVersion(
      probeContext('   ', () => {
        throw new Error('probe must not be invoked for whitespace URL');
      }),
    );

    expect(outcome.kind).toBe('no-database-url');
  });

  it('returns ok with the server version when the server meets minimum', async () => {
    const outcome = await probeServerVersion(
      probeContext('postgres://localhost:5432/db', async () => ({
        kind: 'server-version',
        serverVersion: '15.2',
      })),
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
      probeContext(
        'mongodb://localhost:27017/db',
        async () => ({ kind: 'server-version', serverVersion: '5.0.10' }),
        '6.0',
      ),
    );

    expect(outcome).toMatchObject({
      kind: 'below-minimum',
      serverVersion: '5.0.10',
      minVersion: '6.0',
      message: expect.stringContaining('below the declared minimum'),
    });
  });

  it('returns connection-failed and redacts URL secrets when the probe rejects', async () => {
    const outcome = await probeServerVersion(
      probeContext('postgres://alice:hunter2@localhost:5432/db', async () => {
        throw new Error('connect ECONNREFUSED postgres://alice:hunter2@localhost:5432');
      }),
    );

    expect(outcome).toMatchObject({
      kind: 'connection-failed',
      cause: 'connect ECONNREFUSED postgres://****:****@localhost:5432',
    });
  });

  it('returns driver-missing when the probe cannot load its driver', async () => {
    const outcome = await probeServerVersion(
      probeContext('postgres://localhost:5432/db', async () => ({
        kind: 'driver-missing',
        driver: 'pg',
        cause: "Cannot find module 'pg'",
      })),
    );

    expect(outcome).toMatchObject({
      kind: 'driver-missing',
      cause:
        "`pg` is not installed in this project (resolved from /tmp; cause: Cannot find module 'pg')",
    });
  });

  it('returns unsupported when the target package has no probe', async () => {
    const outcome = await probeServerVersion(
      probeContext('postgres://localhost:5432/db', undefined),
    );

    expect(outcome).toMatchObject({
      kind: 'unsupported',
      message: 'Skipped --probe-db: @example/target cannot check the server.',
    });
  });

  it('calls the probe once with the connection string', async () => {
    const probe = vi.fn(
      async (): Promise<InitProbeResult> => ({
        kind: 'server-version',
        serverVersion: '7.0.1',
      }),
    );

    const outcome = await probeServerVersion(
      probeContext('mongodb://localhost:27017/db', probe, '6.0'),
    );

    expect(probe).toHaveBeenCalledWith('mongodb://localhost:27017/db');
    expect(outcome.kind).toBe('ok');
  });
});
