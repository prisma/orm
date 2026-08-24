import type {
  SchemaDiffIssue,
  VerifyDatabaseSchemaResult,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { NextAction } from '@internal/utils/structured-error';
import { CliStructuredError } from './control';

// ============================================================================
// Runtime Errors (CONTRACT.*, MIGRATION.*)
// ============================================================================

/**
 * Contract marker not found in database.
 */
export function errorMarkerMissing(options?: { readonly why?: string }): CliStructuredError {
  return new CliStructuredError('CONTRACT.MARKER_MISSING', 'Database not signed', {
    why: options?.why ?? 'No database signature (marker) found',
    fix: 'Run `{bin} db sign --db <url>` to sign the database',
    nextActions: [
      { kind: 'run-command', label: 'Sign the database', command: '{bin} db sign --db <url>' },
    ],
  });
}

/**
 * Contract hash does not match database marker.
 */
export function errorHashMismatch(options?: {
  readonly why?: string;
  readonly expected?: string;
  readonly actual?: string;
}): CliStructuredError {
  return new CliStructuredError('CONTRACT.MARKER_MISMATCH', 'Hash mismatch', {
    why: options?.why ?? 'Contract hash does not match database marker',
    fix: 'Migrate database or re-sign if intentional',
    ...(options?.expected !== undefined || options?.actual !== undefined
      ? {
          meta: {
            ...ifDefined('expected', options?.expected),
            ...ifDefined('actual', options?.actual),
          },
        }
      : {}),
  });
}

/**
 * Contract target does not match config target.
 */
export function errorTargetMismatch(
  expected: string,
  actual: string,
  options?: {
    readonly why?: string;
  },
): CliStructuredError {
  return new CliStructuredError('CONTRACT.TARGET_MISMATCH', 'Target mismatch', {
    why:
      options?.why ??
      `Contract target does not match config target (expected: ${expected}, actual: ${actual})`,
    fix: 'Align contract target and config target',
    meta: { expected, actual },
  });
}

/**
 * Marker row exists but column values fail schema validation.
 */
export function errorMarkerRowCorrupt(options: {
  readonly why: string;
  readonly space: string;
  readonly markerLocation: string;
  readonly cause?: unknown;
}): CliStructuredError {
  return new CliStructuredError(
    'CONTRACT.MARKER_ROW_CORRUPT',
    'Marker row is corrupt or incompatible',
    {
      why: options.why,
      fix: `The ${options.markerLocation} row for space "${options.space}" contains invalid data. Delete the row, then run \`{bin} db sign --db <url>\` to write a fresh marker.`,
      nextActions: [
        {
          kind: 'run-command',
          label: 'Write a fresh marker',
          command: '{bin} db sign --db <url>',
          reason: `Delete the invalid ${options.markerLocation} row for space "${options.space}" first — this command then writes a valid one.`,
        },
      ],
      meta: { space: options.space },
      ...ifDefined('cause', options.cause),
    },
  );
}

/**
 * Driver-level failure while reading the contract marker table.
 */
export function errorMarkerReadFailed(options: {
  readonly why: string;
  readonly space: string;
  readonly markerLocation: string;
  readonly cause?: unknown;
}): CliStructuredError {
  return new CliStructuredError(
    'CONTRACT.MARKER_READ_FAILED',
    'Database error while reading contract marker',
    {
      why: options.why,
      fix: `Could not read marker at ${options.markerLocation} for space "${options.space}". Verify read permissions, connectivity, and locks, then retry.`,
      meta: { space: options.space },
      ...ifDefined('cause', options.cause),
    },
  );
}

function isMarkerRowParseError(err: unknown): err is Error {
  return (
    err instanceof Error &&
    (err.message.startsWith('Invalid contract marker row:') ||
      err.message.startsWith('Invalid marker doc on'))
  );
}

function isLegacyMarkerShapeReadError(message: string): boolean {
  const normalized = message.toLowerCase();
  return (
    normalized.includes('column "space" does not exist') ||
    normalized.includes('no such column: space')
  );
}

function errorLegacyMarkerShape(options: {
  readonly why: string;
  readonly markerLocation: string;
  readonly cause?: unknown;
}): CliStructuredError {
  return errorRunnerFailed(
    `Legacy marker-table shape detected on ${options.markerLocation} (no \`space\` column). ` +
      'Prisma Next is in pre-1.0; the previous transitional auto-migration to the per-space-row schema has been removed. ' +
      `Drop \`${options.markerLocation}\` and re-run \`{bin} db init\` to reinitialise from a clean baseline.`,
    {
      why: options.why,
      fix: 'Legacy marker-table shape detected. Drop `prisma_contract.marker` (Postgres) or `_prisma_marker` (SQLite) and re-run `{bin} db init` to recreate it with the current per-space schema.',
      nextActions: [
        {
          kind: 'run-command',
          label: 'Reinitialise the marker table from a clean baseline',
          command: '{bin} db init',
          reason: `Drop \`${options.markerLocation}\` first — it has the legacy shape (no \`space\` column) and this command recreates it with the current per-space schema.`,
        },
      ],
      meta: { runnerErrorCode: 'MIGRATION.LEGACY_MARKER_SHAPE' },
      ...ifDefined('cause', options.cause),
    },
  );
}

export function rethrowMarkerReadError(
  err: unknown,
  context: { readonly space: string; readonly markerLocation: string },
): never {
  if (CliStructuredError.is(err)) {
    throw err;
  }
  if (isMarkerRowParseError(err)) {
    throw errorMarkerRowCorrupt({
      why: err.message,
      space: context.space,
      markerLocation: context.markerLocation,
      cause: err,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
  if (isLegacyMarkerShapeReadError(message)) {
    throw errorLegacyMarkerShape({
      why: message,
      markerLocation: context.markerLocation,
      cause: err,
    });
  }
  throw errorMarkerReadFailed({
    why: message,
    space: context.space,
    markerLocation: context.markerLocation,
    cause: err,
  });
}

export async function withMarkerReadErrorHandling<T>(
  operation: () => Promise<T>,
  context: { readonly space: string; readonly markerLocation: string },
): Promise<T> {
  try {
    return await operation();
  } catch (err) {
    rethrowMarkerReadError(err, context);
  }
}

export function parseMarkerRowSafely<T>(
  row: unknown,
  parse: (value: unknown) => T,
  context: { readonly space: string; readonly markerLocation: string },
): T {
  try {
    return parse(row);
  } catch (err) {
    rethrowMarkerReadError(err, context);
  }
}

/**
 * Database marker is required but not found.
 * Used by commands that require a pre-existing marker as a precondition.
 */
export function errorMarkerRequired(options?: {
  readonly why?: string;
  readonly fix?: string;
  readonly nextActions?: readonly NextAction[];
}): CliStructuredError {
  return new CliStructuredError('CONTRACT.MARKER_REQUIRED', 'Database must be signed first', {
    why: options?.why ?? 'No database signature (marker) found',
    fix: options?.fix ?? 'Run `{bin} db init` first to sign the database',
    nextActions: options?.nextActions ?? [
      { kind: 'run-command', label: 'Sign the database', command: '{bin} db init' },
    ],
  });
}

/**
 * Schema verification found mismatches between the database and the contract.
 * The full verification result is preserved in `meta.verificationResult`.
 */
export function errorSchemaVerificationFailed(options: {
  readonly summary: string;
  readonly verificationResult: VerifyDatabaseSchemaResult;
  readonly issues?: readonly SchemaDiffIssue[];
}): CliStructuredError {
  return new CliStructuredError('CONTRACT.SCHEMA_VERIFICATION_FAILED', options.summary, {
    why: 'Database schema does not satisfy the contract',
    fix: 'Run `{bin} db update` to reconcile, or adjust your contract to match the database',
    nextActions: [
      { kind: 'run-command', label: 'Reconcile the database', command: '{bin} db update' },
      { kind: 'edit-file', label: 'Adjust your contract to match the database' },
    ],
    meta: {
      verificationResult: options.verificationResult,
      ...ifDefined('issues', options.issues),
    },
  });
}

/**
 * Migration runner failed during execution.
 */
export function errorRunnerFailed(
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly nextActions?: readonly NextAction[];
    readonly meta?: Record<string, unknown>;
    readonly cause?: unknown;
  },
): CliStructuredError {
  return new CliStructuredError('MIGRATION.RUNNER_FAILED', summary, {
    why: options?.why ?? 'Migration runner failed',
    fix: options?.fix ?? 'Inspect the reported conflict and reconcile schema drift',
    ...ifDefined('nextActions', options?.nextActions),
    ...(options?.meta ? { meta: options.meta } : {}),
    ...ifDefined('cause', options?.cause),
  });
}

/** Error code for destructive changes that require explicit confirmation. */
export const ERROR_CODE_DESTRUCTIVE_CHANGES = 'MIGRATION.DESTRUCTIVE_CHANGES';

/**
 * Destructive operations require explicit confirmation via -y/--yes.
 */
export function errorDestructiveChanges(
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly meta?: Record<string, unknown>;
  },
): CliStructuredError {
  return new CliStructuredError(ERROR_CODE_DESTRUCTIVE_CHANGES, summary, {
    why: options?.why ?? 'Planned operations include destructive changes that require confirmation',
    fix: options?.fix ?? 'Re-run with `-y` to apply, or use `--dry-run` to preview first',
    ...(options?.meta ? { meta: options.meta } : {}),
  });
}

export const ERROR_CODE_CONSENT_PLAN_MISMATCH = 'MIGRATION.CONSENT_PLAN_MISMATCH';

/**
 * An apply carrying consent was refused because the plan recomputed for it is
 * not the plan that was consented to.
 */
export function errorConsentPlanMismatch(options: {
  readonly consentedPlanHash: string;
  readonly planHash: string;
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError(
    ERROR_CODE_CONSENT_PLAN_MISMATCH,
    'The plan changed between consent and apply',
    {
      why:
        options.why ??
        'The plan recomputed for the consented apply is not the plan that was consented to, so applying it could destroy something nobody agreed to.',
      fix: 'Re-run the command and review the freshly planned operations before consenting again',
      meta: {
        consentedPlanHash: options.consentedPlanHash,
        planHash: options.planHash,
      },
    },
  );
}

/**
 * Generic runtime error carrying a caller-provided dotted code.
 */
export function errorRuntime(
  code: `${string}.${string}`,
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly meta?: Record<string, unknown>;
    readonly cause?: unknown;
  },
): CliStructuredError {
  return new CliStructuredError(code, summary, {
    ...ifDefined('why', options?.why),
    ...ifDefined('fix', options?.fix),
    ...ifDefined('meta', options?.meta),
    ...ifDefined('cause', options?.cause),
  });
}
