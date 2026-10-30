import { ifDefined } from '@internal/utils/defined';
import {
  type Diagnostic,
  isStructuredError,
  type NextAction,
  type StructuredError,
} from '@internal/utils/structured-error';
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
 * The application space's marker row records policies that cannot be read. Deleting the row would
 * drop the policies and the invariants it records, so the advice keeps it.
 */
export function errorMarkerPoliciesCorrupt(options: {
  readonly why: string;
  readonly space: string;
  readonly markerLocation: string;
}): CliStructuredError {
  const advice =
    'Ask whoever owns this database to correct meta.policies in the marker row; do not delete the row.';
  return new CliStructuredError(
    'CONTRACT.MARKER_ROW_CORRUPT',
    'Marker row is corrupt or incompatible',
    {
      why: options.why,
      fix: `${advice} The ${options.markerLocation} row for space "${options.space}" also records the database's contract and invariants.`,
      nextActions: [{ kind: 'user-choice', label: advice }],
      meta: { space: options.space },
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

function isDriverError(err: unknown): boolean {
  return isStructuredError(err) && err.code.startsWith('DRIVER.');
}

function isMarkerRowCorruptError(err: unknown): err is StructuredError {
  return isStructuredError(err) && err.code === 'CONTRACT.MARKER_ROW_CORRUPT';
}

export function rethrowMarkerReadError(
  err: unknown,
  context: { readonly space: string; readonly markerLocation: string },
): never {
  if (CliStructuredError.is(err) || isDriverError(err)) {
    throw err;
  }
  if (isMarkerRowCorruptError(err)) {
    throw errorMarkerRowCorrupt({
      why: err.message,
      space: context.space,
      markerLocation: context.markerLocation,
      cause: err,
    });
  }
  const message = err instanceof Error ? err.message : String(err);
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
 * Generic runtime error carrying a caller-provided dotted code.
 */
export function errorRuntime(
  code: `${string}.${string}`,
  summary: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly diagnostics?: readonly Diagnostic[];
    readonly meta?: Record<string, unknown>;
    readonly cause?: unknown;
  },
): CliStructuredError {
  return new CliStructuredError(code, summary, {
    ...ifDefined('why', options?.why),
    ...ifDefined('fix', options?.fix),
    ...ifDefined('diagnostics', options?.diagnostics),
    ...ifDefined('meta', options?.meta),
    ...ifDefined('cause', options?.cause),
  });
}
