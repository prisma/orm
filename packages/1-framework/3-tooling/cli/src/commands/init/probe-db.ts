import { type } from 'arktype';
import { redactUrlCredentials } from '../../utils/url-credentials';
import type { InitContribution } from './init-contribution';

const ProbeResultSchema = type({ kind: "'server-version'", serverVersion: 'string' })
  .or({ kind: "'version-unreadable'", detail: 'string' })
  .or({ kind: "'driver-missing'", driver: 'string', cause: 'string' });

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
      readonly minVersion: string | undefined;
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
      readonly kind: 'no-database-url' | 'unsupported';
      readonly minVersion: string | undefined;
      readonly meetsMinimum: null;
      readonly message: string;
    }
  | {
      readonly kind:
        | 'connection-failed'
        | 'driver-missing'
        | 'version-unreadable'
        | 'invalid-result';
      readonly minVersion: string | undefined;
      readonly meetsMinimum: null;
      readonly cause: string;
      readonly message: string;
    };

export interface ProbeContext {
  readonly databaseUrl: string | undefined;
  readonly packageName: string;
  readonly contribution: Pick<InitContribution, 'probe' | 'serverRequirement'>;
}

/**
 * Connects (when configured) to the user's database through the target
 * package's probe and returns a structured outcome describing whether the
 * server meets the minimum the package states (FR8.1). No I/O happens
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
 * - `no-database-url` / `connection-failed` / `driver-missing` /
 *   `version-unreadable` / `unsupported` — warning by default, fatal under
 *   `--strict-probe`.
 * - `invalid-result` — the target package's probe answered with a value of the
 *   wrong shape, which is a defect in that package; always fatal.
 */
export async function probeServerVersion(ctx: ProbeContext): Promise<ProbeOutcome> {
  const { databaseUrl, contribution } = ctx;
  const minVersion = contribution.serverRequirement?.minVersion;
  if (databaseUrl === undefined || databaseUrl.trim().length === 0) {
    return {
      kind: 'no-database-url',
      minVersion,
      meetsMinimum: null,
      message:
        'Skipped --probe-db: DATABASE_URL is not set in the current shell environment. (init does not read .env for the probe; export the variable or drop --probe-db.)',
    };
  }
  if (contribution.probe === undefined) {
    return {
      kind: 'unsupported',
      minVersion,
      meetsMinimum: null,
      message: `Skipped --probe-db: ${ctx.packageName} cannot check the server.`,
    };
  }

  let answer: unknown;
  try {
    answer = await contribution.probe(databaseUrl);
  } catch (err) {
    const cause = redactUrlCredentials(causeMessage(err));
    return {
      kind: 'connection-failed',
      minVersion,
      meetsMinimum: null,
      cause,
      message: `--probe-db could not connect: ${cause}.`,
    };
  }

  const result = ProbeResultSchema(answer);
  if (result instanceof type.errors) {
    const cause = `the probe of ${ctx.packageName} answered with a value of the wrong shape: ${result.summary}`;
    return {
      kind: 'invalid-result',
      minVersion,
      meetsMinimum: null,
      cause,
      message: `--probe-db failed: ${cause}.`,
    };
  }
  if (result.kind === 'driver-missing') {
    const cause = `\`${result.driver}\` could not be loaded by ${ctx.packageName} (cause: ${result.cause})`;
    return {
      kind: 'driver-missing',
      minVersion,
      meetsMinimum: null,
      cause,
      message: `Skipped --probe-db: ${cause}. (Run with install enabled, or install the driver yourself, then re-run \`prisma orm init --probe-db\`.)`,
    };
  }
  if (result.kind === 'version-unreadable') {
    const cause = redactUrlCredentials(result.detail);
    return {
      kind: 'version-unreadable',
      minVersion,
      meetsMinimum: null,
      cause,
      message: `--probe-db connected to the server, but could not read its version: ${cause}.`,
    };
  }
  const { serverVersion } = result;

  if (minVersion === undefined) {
    return {
      kind: 'ok',
      serverVersion,
      minVersion,
      meetsMinimum: true,
      message: `--probe-db: server reports version ${serverVersion}.`,
    };
  }
  if (compareVersionPrefix(serverVersion, minVersion) < 0) {
    return {
      kind: 'below-minimum',
      serverVersion,
      minVersion,
      meetsMinimum: false,
      message: `--probe-db: server reports version ${serverVersion}, below the declared minimum (${minVersion}). Some queries may fail until the server is upgraded.`,
    };
  }
  return {
    kind: 'ok',
    serverVersion,
    minVersion,
    meetsMinimum: true,
    message: `--probe-db: server reports version ${serverVersion} (>= ${minVersion}).`,
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

function causeMessage(err: unknown): string {
  if (err instanceof Error) return err.message;
  return String(err);
}
