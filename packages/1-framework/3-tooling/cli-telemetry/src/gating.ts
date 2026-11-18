import type { UserConfig } from './user-config';

/**
 * Why telemetry was disabled. Useful for debug-mode logging in the
 * parent; never surfaces to users.
 */
export type GatingDisabledReason = 'env-override' | 'stored-opt-out';

export type GatingResolution =
  | { readonly enabled: true }
  | { readonly enabled: false; readonly reason: GatingDisabledReason };

export interface GatingInputs {
  /**
   * Environment-variable lookups the resolver consults. Tests pass a
   * literal record; production passes `process.env`. The two opt-out
   * signals are `PRISMA_DISABLE_TELEMETRY` (Prisma-specific) and
   * `DO_NOT_TRACK` (community convention).
   */
  readonly env: Readonly<Record<string, string | undefined>>;
  /** Result of `readUserConfig()` — file-missing tolerated as `{}`. */
  readonly config: UserConfig;
}

/**
 * A `PRISMA_DISABLE_TELEMETRY` value counts as an opt-out only if
 * it parses as a truthy string. The set-but-falsy spellings (`''`,
 * `'0'`, `'false'`) are intentionally treated as not-set so a parent
 * shell that exports the variable to a benign value doesn't accidentally
 * disable telemetry for child processes.
 */
function isTruthyOptOut(raw: string | undefined): boolean {
  if (raw === undefined) return false;
  const normalised = raw.trim().toLowerCase();
  if (normalised === '') return false;
  if (normalised === '0') return false;
  if (normalised === 'false') return false;
  return true;
}

/**
 * Pure-function resolution of the gating decision. Same input → same
 * output; no I/O. The caller is responsible for reading the env and the
 * user config.
 *
 * Decision order:
 *   1. Env-var override (`PRISMA_DISABLE_TELEMETRY` truthy, its
 *      `PRISMA_NEXT_DISABLE_TELEMETRY` spelling from earlier releases, or
 *      `DO_NOT_TRACK=1`) → disabled. The env check runs first, so an
 *      opt-out env var wins over any stored or unset preference.
 *   2. Stored `enableTelemetry === false` → disabled (`stored-opt-out`).
 *   3. Stored `enableTelemetry === true` → enabled.
 *   4. Stored `enableTelemetry === undefined` (file missing, or field
 *      not set) → ENABLED. This is the opt-out default: absence of an
 *      explicit choice means telemetry is on. This is the load-bearing,
 *      counter-intuitive branch — do not "fix" it to default-off.
 *
 * Telemetry is disabled only when an env override is active or
 * `enableTelemetry` is explicitly `false`.
 */
export function resolveGating(inputs: GatingInputs): GatingResolution {
  if (
    isTruthyOptOut(inputs.env['PRISMA_DISABLE_TELEMETRY']) ||
    isTruthyOptOut(inputs.env['PRISMA_NEXT_DISABLE_TELEMETRY']) ||
    inputs.env['DO_NOT_TRACK'] === '1'
  ) {
    return { enabled: false, reason: 'env-override' };
  }
  if (inputs.config.enableTelemetry === false) {
    return { enabled: false, reason: 'stored-opt-out' };
  }
  return { enabled: true };
}
