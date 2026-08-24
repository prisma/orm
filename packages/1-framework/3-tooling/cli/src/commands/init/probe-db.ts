import { createRequire } from 'node:module';
import { CliStructuredError } from '@internal/errors/control';
import { suppressIdleConnectionErrors } from '@internal/utils/suppress-idle-connection-errors';
import { join } from 'pathe';
import type { TargetId } from './templates/code-templates';

/**
 * Result of an attempted database probe (FR8.3). `kind` is the
 * machine-readable status; `message` is the human-readable line we
 * surface in `init`'s warning channel (or, under `--strict-probe`, in
 * the structured error). The probe never throws — every failure
 * mode is folded into one of these variants so `runInit` can branch
 * exactly once.
 */
export type ProbeOutcome =
  | {
      readonly kind: 'ok';
      readonly serverVersion: string;
      readonly minVersion: string;
      readonly meetsMinimum: true;
      readonly message: string;
    }
  | {
      readonly kind: 'below-minimum';
      readonly serverVersion: string;
      readonly minVersion: string;
      readonly meetsMinimum: false;
      readonly message: string;
    }
  | {
      readonly kind: 'no-database-url';
      readonly minVersion: string;
      readonly meetsMinimum: null;
      readonly message: string;
    }
  | {
      readonly kind: 'connection-failed';
      readonly minVersion: string;
      readonly meetsMinimum: null;
      readonly cause: string;
      readonly message: string;
    }
  | {
      readonly kind: 'driver-missing';
      readonly minVersion: string;
      readonly meetsMinimum: null;
      readonly cause: string;
      readonly message: string;
    };

export interface ProbeContext {
  readonly baseDir: string;
  readonly target: TargetId;
  readonly databaseUrl: string | undefined;
  readonly minVersion: string;
}

/**
 * Optional injection seam exposed for unit tests so the probe logic
 * (env handling, version parsing, comparator, message formatting) can
 * be exercised without a live database. Production callers omit this
 * argument and get the real `pg` / `mongodb` driver path.
 */
export interface ProbeOverrides {
  readonly probePostgres?: (databaseUrl: string) => Promise<DriverResult>;
  readonly probeMongo?: (databaseUrl: string) => Promise<DriverResult>;
  readonly requireFromBaseDir?: (baseDir: string, moduleId: string) => unknown;
}

interface DriverResult {
  readonly serverVersion: string;
}

/**
 * Connects (when configured) to the user's database and returns a
 * structured outcome describing whether the server meets the declared
 * minimum (FR8.1). Pure with respect to its inputs: no I/O happens
 * unless `databaseUrl` is set.
 *
 * The outcome is shaped so that `--strict-probe` can branch on the
 * `kind`/`meetsMinimum` pair without re-stringifying the message:
 *
 * - `ok` — informational; `init` continues.
 * - `below-minimum` — warning; `init` continues regardless of
 *   `--strict-probe` (the spec scopes strict-probe to "probe
 *   *failures*", and a successful probe that finds an old server is
 *   not a failure).
 * - `no-database-url` / `connection-failed` / `driver-missing` —
 *   warning by default, fatal under `--strict-probe`.
 */
export async function probeServerVersion(
  ctx: ProbeContext,
  overrides: ProbeOverrides = {},
): Promise<ProbeOutcome> {
  const { databaseUrl, minVersion, target } = ctx;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    return {
      kind: 'no-database-url',
      minVersion,
      meetsMinimum: null,
      message:
        'Skipped --probe-db: DATABASE_URL is not set in the current shell environment. (init does not read .env for the probe; export the variable or drop --probe-db.)',
    };
  }

  let driverResult: DriverResult;
  try {
    if (target === 'postgres') {
      driverResult =
        overrides.probePostgres !== undefined
          ? await overrides.probePostgres(databaseUrl)
          : await defaultProbePostgres(databaseUrl, ctx.baseDir, overrides);
    } else {
      driverResult =
        overrides.probeMongo !== undefined
          ? await overrides.probeMongo(databaseUrl)
          : await defaultProbeMongo(databaseUrl, ctx.baseDir, overrides);
    }
  } catch (err) {
    if (err instanceof DriverMissingError) {
      return {
        kind: 'driver-missing',
        minVersion,
        meetsMinimum: null,
        cause: err.message,
        message: `Skipped --probe-db: ${err.message}. (Run with install enabled, or install the driver yourself, then re-run \`prisma orm init --probe-db\`.)`,
      };
    }
    const cause = redactDatabaseUrlSecrets(causeMessage(err));
    return {
      kind: 'connection-failed',
      minVersion,
      meetsMinimum: null,
      cause,
      message: `--probe-db could not connect: ${cause}.`,
    };
  }

  const meets = compareVersionPrefix(driverResult.serverVersion, minVersion);
  if (meets < 0) {
    return {
      kind: 'below-minimum',
      serverVersion: driverResult.serverVersion,
      minVersion,
      meetsMinimum: false,
      message: `--probe-db: server reports version ${driverResult.serverVersion}, below the declared minimum (${minVersion}). Some queries may fail until the server is upgraded.`,
    };
  }
  return {
    kind: 'ok',
    serverVersion: driverResult.serverVersion,
    minVersion,
    meetsMinimum: true,
    message: `--probe-db: server reports version ${driverResult.serverVersion} (>= ${minVersion}).`,
  };
}

/**
 * Compares two semver-prefix strings ("14", "14.2", "6.0", …) by
 * numeric components left-to-right. Returns a negative number when `a`
 * is older than `b`, zero when both versions agree on every numeric
 * component (treating missing trailing components as `0`), and a
 * positive number when `a` is newer.
 *
 * The loop runs over the **longer** of the two prefixes so that
 * `'14'` compares less than `'14.1'` — without that, the shorter
 * prefix would be silently accepted whenever the configured minimum
 * has a non-zero minor or patch.
 *
 * Exported for unit tests.
 */
export function compareVersionPrefix(a: string, b: string): number {
  const aParts = parseNumericParts(a);
  const bParts = parseNumericParts(b);
  const len = Math.max(aParts.length, bParts.length);
  for (let i = 0; i < len; i += 1) {
    const aPart = aParts[i] ?? 0;
    const bPart = bParts[i] ?? 0;
    if (aPart !== bPart) return aPart - bPart;
  }
  return 0;
}

function parseNumericParts(version: string): readonly number[] {
  const match = version.match(/^[^\d]*(\d+(?:\.\d+){0,3})/);
  if (match === null) return [];
  return (match[1] ?? '').split('.').map((part) => Number.parseInt(part, 10));
}

class DriverMissingError extends Error {}

function causeMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}

/**
 * Strips `user:password@` userinfo from any URL-shaped substring before
 * we surface the cause to the user. Mirrors `redactSecrets` in
 * `init.ts` — the probe path has its own redactor because the inputs
 * here include the raw connection string by construction (driver
 * errors echo the URL back).
 *
 * Exported for unit tests.
 */
export function redactDatabaseUrlSecrets(text: string): string {
  if (!text) return text;
  return text.replace(/([a-zA-Z][a-zA-Z0-9+.-]*:\/\/)([^/@\s]+)@/g, '$1***@');
}

async function defaultProbePostgres(
  databaseUrl: string,
  baseDir: string,
  overrides: ProbeOverrides,
): Promise<DriverResult> {
  const pg = requirePeer<{ Client: new (cfg: { connectionString: string }) => PgClient }>(
    'pg',
    baseDir,
    overrides,
  );
  const client = suppressIdleConnectionErrors(new pg.Client({ connectionString: databaseUrl }));
  try {
    await client.connect();
    const result = await client.query('SELECT version() as version');
    const versionString = String(result?.rows?.[0]?.version ?? '');
    const parsed = parsePostgresVersion(versionString);
    return { serverVersion: parsed };
  } finally {
    await client.end().catch(() => undefined);
  }
}

interface PgClient {
  on(event: 'error', listener: (err: Error) => void): unknown;
  connect(): Promise<void>;
  query(sql: string): Promise<{ rows: ReadonlyArray<{ version: string }> }>;
  end(): Promise<void>;
}

/**
 * Extracts the numeric prefix from a Postgres `version()` row, e.g.
 *
 *   `PostgreSQL 14.10 on x86_64-pc-linux-gnu, ...`  → `"14.10"`
 *   `PostgreSQL 16beta1 on …`                       → `"16"` (we
 *      conservatively drop the suffix; minimum-version comparisons
 *      treat 16beta1 as 16, which is what every reasonable user
 *      expects).
 *
 * Exported for unit tests.
 */
export function parsePostgresVersion(versionString: string): string {
  const match = versionString.match(/PostgreSQL\s+(\d+(?:\.\d+)?)/i);
  if (match === null || match[1] === undefined) {
    throw new CliStructuredError(
      'CLI.INIT_PROBE_FAILED',
      `Could not parse PostgreSQL version from \`${versionString}\``,
    );
  }
  return match[1];
}

async function defaultProbeMongo(
  databaseUrl: string,
  baseDir: string,
  overrides: ProbeOverrides,
): Promise<DriverResult> {
  const mongodb = requirePeer<{
    MongoClient: new (
      url: string,
    ) => {
      connect(): Promise<unknown>;
      db(name?: string): {
        admin(): { command(cmd: Record<string, unknown>): Promise<{ version?: string }> };
      };
      close(): Promise<void>;
    };
  }>('mongodb', baseDir, overrides);
  const client = new mongodb.MongoClient(databaseUrl);
  await client.connect();
  try {
    const buildInfo = await client.db().admin().command({ buildInfo: 1 });
    const versionString = String(buildInfo.version ?? '');
    if (versionString.length === 0) {
      throw new CliStructuredError(
        'CLI.INIT_PROBE_FAILED',
        'buildInfo did not include a `version` field',
      );
    }
    return { serverVersion: versionString };
  } finally {
    await client.close().catch(() => undefined);
  }
}

/**
 * Loads a peer driver (`pg` / `mongodb`) from the user's project
 * `node_modules`. We deliberately resolve from `baseDir` rather than
 * from the CLI bundle — the CLI does not depend on `pg` or `mongodb`
 * directly, but the user's `init`-generated `package.json` does (via
 * the target facade). Failure to resolve is folded into a typed
 * `DriverMissingError` so `probeServerVersion` can map it to a
 * `driver-missing` outcome rather than letting a `MODULE_NOT_FOUND`
 * leak as a generic connection failure.
 */
function requirePeer<T>(moduleId: string, baseDir: string, overrides: ProbeOverrides): T {
  try {
    if (overrides.requireFromBaseDir !== undefined) {
      return overrides.requireFromBaseDir(baseDir, moduleId) as T;
    }
    const requireFromBase = createRequire(join(baseDir, 'package.json'));
    return requireFromBase(moduleId) as T;
  } catch (err) {
    throw new DriverMissingError(
      `\`${moduleId}\` is not installed in this project (resolved from ${baseDir}; cause: ${causeMessage(err)})`,
    );
  }
}
