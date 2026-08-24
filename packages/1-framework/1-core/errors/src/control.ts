import { ifDefined } from '@internal/utils/defined';
import type { NextAction, StructuredError } from '@internal/utils/structured-error';
import { docsUrlFor } from '@internal/utils/structured-error';

/**
 * CLI error envelope for output formatting.
 * This is the serialized form of a CliStructuredError.
 *
 * `nextActions` is required here even though it is optional on the raised
 * error: a consumer reading a serialized envelope must never have to tell
 * "no remediation" apart from "field absent". See
 * [ADR 239](../../../../../docs/architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md#which-surface-guarantees-nextactions).
 *
 * A `command` inside `nextActions` still carries the `{bin}` placeholder here;
 * the surface that renders the envelope substitutes the running binary's name.
 */
export interface CliErrorEnvelope {
  readonly ok: false;
  readonly code: string;
  readonly severity: 'error' | 'warn' | 'info';
  readonly summary: string;
  readonly why?: string;
  readonly fix?: string;
  readonly nextActions: readonly NextAction[];
  readonly where?: { readonly path?: string; readonly line?: number };
  readonly meta?: Record<string, unknown>;
  readonly docsUrl?: string;
}

/**
 * Minimal conflict data structure expected by CLI output.
 */
export interface CliErrorConflict {
  readonly kind: string;
  readonly summary: string;
  readonly why?: string;
}

/**
 * Structured CLI error that contains all information needed for error envelopes.
 * Call sites throw these errors with full context.
 *
 * A `CliStructuredError` is a `StructuredError` (see
 * `@internal/utils/structured-error`): `code` is a dotted
 * `NAMESPACE.SUBCODE` string, and the namespace prefix is the error's
 * category — there is no separate `domain` field. See
 * [ADR 239](../../../../../docs/architecture%20docs/adrs/ADR%20239%20-%20Errors%20are%20structural%20envelopes%20with%20dotted%20namespace%20codes.md)
 * for the namespace taxonomy.
 */
export class CliStructuredError extends Error implements StructuredError {
  readonly code: `${string}.${string}`;
  readonly severity: 'error' | 'warn' | 'info';
  declare readonly why?: string;
  declare readonly fix?: string;
  declare readonly nextActions?: readonly NextAction[];
  declare readonly where?: { readonly path?: string; readonly line?: number };
  declare readonly meta?: Record<string, unknown>;
  declare readonly docsUrl?: string;

  constructor(
    code: `${string}.${string}`,
    summary: string,
    options?: {
      readonly severity?: 'error' | 'warn' | 'info';
      readonly why?: string;
      readonly fix?: string;
      readonly nextActions?: readonly NextAction[];
      readonly where?: { readonly path?: string; readonly line?: number };
      readonly meta?: Record<string, unknown>;
      readonly docsUrl?: string;
      readonly cause?: unknown;
    },
  ) {
    super(summary, options?.cause !== undefined ? { cause: options.cause } : undefined);
    this.name = 'CliStructuredError';
    this.code = code;
    this.severity = options?.severity ?? 'error';
    const fix = options?.fix === options?.why ? undefined : options?.fix;
    const where = options?.where
      ? { ...ifDefined('path', options.where.path), ...ifDefined('line', options.where.line) }
      : undefined;
    Object.assign(this, {
      ...ifDefined('why', options?.why),
      ...ifDefined('fix', fix),
      ...ifDefined('nextActions', options?.nextActions),
      ...ifDefined('where', where),
      ...ifDefined('meta', options?.meta),
      ...ifDefined('docsUrl', options?.docsUrl),
    });
  }

  /**
   * Converts this error to a CLI error envelope for output formatting.
   *
   * This is the boundary that emits the envelope, so it is where a missing
   * `nextActions` becomes `[]`.
   */
  toEnvelope(): CliErrorEnvelope {
    return {
      ok: false as const,
      code: this.code,
      severity: this.severity,
      summary: this.message,
      ...ifDefined('why', this.why),
      ...ifDefined('fix', this.fix),
      nextActions: this.nextActions ?? [],
      ...ifDefined('where', this.where),
      ...ifDefined('meta', this.meta),
      ...ifDefined('docsUrl', this.docsUrl),
    };
  }

  /**
   * Type guard to check if an error is a CliStructuredError.
   * Uses duck-typing to work across module boundaries where instanceof may fail.
   */
  static is(error: unknown): error is CliStructuredError {
    if (!(error instanceof Error)) {
      return false;
    }
    const candidate = error as CliStructuredError;
    return (
      candidate.name === 'CliStructuredError' &&
      typeof candidate.code === 'string' &&
      typeof candidate.toEnvelope === 'function'
    );
  }
}

// ============================================================================
// Config Errors
// ============================================================================

/**
 * Config file not found or missing.
 */
export function errorConfigFileNotFound(
  configPath?: string,
  options?: {
    readonly why?: string;
  },
): CliStructuredError {
  return new CliStructuredError('CONFIG.FILE_NOT_FOUND', 'Config file not found', {
    ...(options?.why ? { why: options.why } : { why: 'Config file not found' }),
    fix: "Run '{bin} orm init' to create a config file",
    nextActions: [
      { kind: 'run-command', label: 'Create a config file', command: '{bin} orm init' },
    ],
    docsUrl: docsUrlFor('CONFIG.FILE_NOT_FOUND'),
    ...(configPath ? { where: { path: configPath } } : {}),
  });
}

/**
 * Config module failed to evaluate (syntax error, module threw during import).
 */
export function errorConfigEvaluationFailed(
  configPath: string | undefined,
  options: {
    readonly why: string;
    readonly cause?: unknown;
  },
): CliStructuredError {
  return new CliStructuredError('CONFIG.EVALUATION_FAILED', 'Config file could not be evaluated', {
    why: options.why,
    fix: 'Fix the error in your prisma.config.ts so the module evaluates, then rerun the command',
    docsUrl: docsUrlFor('CONFIG.EVALUATION_FAILED'),
    ...(configPath ? { where: { path: configPath } } : {}),
    ...(options.cause !== undefined ? { cause: options.cause } : {}),
  });
}

/**
 * Config module evaluated, but its export does not carry the defineConfig
 * version marker (plain object export, or a config produced by a different
 * defineConfig such as classic Prisma's).
 */
export function errorConfigVersionMarkerMissing(configPath?: string): CliStructuredError {
  return new CliStructuredError(
    'CONFIG.VERSION_MARKER_MISSING',
    'Config is not a defineConfig result',
    {
      why: 'The config module evaluated, but its default export was not created by a current defineConfig',
      fix: "Create the config with defineConfig from '@prisma/cli-engine', nest your settings under its `orm` section, and export its return value directly",
      docsUrl: docsUrlFor('CONFIG.VERSION_MARKER_MISSING'),
      ...(configPath ? { where: { path: configPath } } : {}),
    },
  );
}

/**
 * Contract configuration missing from config.
 */
export function errorContractConfigMissing(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError('CONFIG.CONTRACT_MISSING', 'Contract configuration missing', {
    why: options?.why ?? 'The contract configuration is required for emit',
    fix: 'Add contract configuration to your prisma.config.ts',
    docsUrl: docsUrlFor('CONFIG.CONTRACT_MISSING'),
  });
}

/**
 * Contract validation failed.
 */
export function errorContractValidationFailed(
  reason: string,
  options?: {
    readonly where?: { readonly path?: string; readonly line?: number };
    readonly cause?: unknown;
  },
): CliStructuredError {
  return new CliStructuredError('CONTRACT.VALIDATION_FAILED', 'Contract validation failed', {
    why: reason,
    fix: 'Re-run `{bin} contract emit`, or fix the contract file and try again',
    nextActions: [
      { kind: 'run-command', label: 'Re-emit the contract', command: '{bin} contract emit' },
      {
        kind: 'edit-file',
        label: 'Fix the contract file, then re-run the command',
        reason: reason,
      },
    ],
    docsUrl: docsUrlFor('CONTRACT.VALIDATION_FAILED'),
    ...(options?.where ? { where: options.where } : {}),
    ...ifDefined('cause', options?.cause),
  });
}

/**
 * File not found.
 */
export function errorFileNotFound(
  filePath: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly docsUrl?: string;
    readonly cause?: unknown;
  },
): CliStructuredError {
  return new CliStructuredError('CLI.FILE_NOT_FOUND', 'File not found', {
    why: options?.why ?? `File not found: ${filePath}`,
    fix: options?.fix ?? 'Check that the file path is correct',
    where: { path: filePath },
    ...(options?.docsUrl ? { docsUrl: options.docsUrl } : {}),
    ...ifDefined('cause', options?.cause),
  });
}

/**
 * Database connection is required but not provided.
 */
export function errorDatabaseConnectionRequired(options?: {
  readonly why?: string;
  readonly commandName?: string;
  readonly retryCommand?: string;
  readonly missingFlags?: readonly string[];
}): CliStructuredError {
  const runHint = options?.retryCommand
    ? `Run \`${options.retryCommand}\``
    : options?.commandName
      ? `Run \`{bin} ${options.commandName} --db <url>\``
      : 'Provide `--db <url>`';
  return new CliStructuredError(
    'CONFIG.DB_CONNECTION_REQUIRED',
    'Database connection is required',
    {
      why: options?.why ?? 'Database connection is required for this command',
      fix: `${runHint}, or set \`db: { connection: "postgres://…" }\` in prisma.config.ts`,
      ...(options?.missingFlags !== undefined
        ? { meta: { missingFlags: [...options.missingFlags] } }
        : {}),
    },
  );
}

/**
 * Query runner factory is required but not provided in config.
 */
export function errorQueryRunnerFactoryRequired(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError(
    'CONFIG.QUERY_RUNNER_FACTORY_REQUIRED',
    'Query runner factory is required',
    {
      why: options?.why ?? 'Config.db.queryRunnerFactory is required for db verify',
      fix: 'Add db.queryRunnerFactory to prisma.config.ts',
      docsUrl: docsUrlFor('CONFIG.QUERY_RUNNER_FACTORY_REQUIRED'),
    },
  );
}

/**
 * Family verify.readMarker is required but not provided.
 */
export function errorFamilyReadMarkerSqlRequired(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError(
    'CONFIG.FAMILY_READ_MARKER_REQUIRED',
    'Family readMarker() is required',
    {
      why: options?.why ?? 'Family verify.readMarker is required for db verify',
      fix: 'Ensure family.verify.readMarker() is exported by your family package',
      docsUrl: docsUrlFor('CONFIG.FAMILY_READ_MARKER_REQUIRED'),
    },
  );
}

/**
 * JSON output format not supported.
 */
export function errorJsonFormatNotSupported(options: {
  readonly command: string;
  readonly format: string;
  readonly supportedFormats: readonly string[];
}): CliStructuredError {
  return new CliStructuredError('CLI.JSON_FORMAT_UNSUPPORTED', 'Unsupported JSON format', {
    why: `The ${options.command} command does not support --json ${options.format}`,
    fix: `Use --json ${options.supportedFormats.join(' or ')}, or omit --json for human output`,
    meta: {
      command: options.command,
      format: options.format,
      supportedFormats: options.supportedFormats,
    },
  });
}

/**
 * Driver is required for DB-connected commands but not provided.
 */
export function errorDriverRequired(options?: { readonly why?: string }): CliStructuredError {
  return new CliStructuredError(
    'CONFIG.DRIVER_REQUIRED',
    'Driver is required for DB-connected commands',
    {
      why: options?.why ?? 'Config.driver is required for DB-connected commands',
      fix: 'Add a control-plane driver to prisma.config.ts (e.g. import a driver descriptor and set `driver: postgresDriver`)',
      docsUrl: docsUrlFor('CONFIG.DRIVER_REQUIRED'),
    },
  );
}

/**
 * Contract requires extension packs that are not provided by config descriptors.
 */
export function errorContractMissingExtensions(options: {
  readonly missingExtensions: readonly string[];
  readonly providedComponentIds: readonly string[];
}): CliStructuredError {
  const missing = [...options.missingExtensions].sort();
  return new CliStructuredError(
    'CONFIG.MISSING_EXTENSION_PACKS',
    'Missing extension packs in config',
    {
      why:
        missing.length === 1
          ? `Contract requires extension pack '${missing[0]}', but CLI config does not provide a matching descriptor.`
          : `Contract requires extension packs ${missing.map((p) => `'${p}'`).join(', ')}, but CLI config does not provide matching descriptors.`,
      fix: 'Add the missing extension descriptors to `extensions` in prisma.config.ts',
      docsUrl: docsUrlFor('CONFIG.MISSING_EXTENSION_PACKS'),
      meta: {
        missingExtensions: missing,
        providedComponentIds: [...options.providedComponentIds].sort(),
      },
    },
  );
}

/**
 * Migration planning failed due to conflicts.
 */
export function errorMigrationPlanningFailed(options: {
  readonly conflicts: readonly CliErrorConflict[];
  readonly why?: string;
}): CliStructuredError {
  const conflictSummaries = options.conflicts.map((c) => c.summary);
  const computedWhy = options.why ?? conflictSummaries.join('\n');

  const conflictFixes = options.conflicts
    .map((c) => c.why)
    .filter((why): why is string => typeof why === 'string');
  const computedFix =
    conflictFixes.length > 0
      ? conflictFixes.join('\n')
      : 'Use `db verify --schema-only` to inspect conflicts, or ensure the database is empty';

  return new CliStructuredError('MIGRATION.PLANNING_FAILED', 'Migration planning failed', {
    why: computedWhy,
    fix: computedFix,
    meta: { conflicts: options.conflicts },
    docsUrl: docsUrlFor('MIGRATION.PLANNING_FAILED'),
  });
}

/**
 * Target does not support migrations (missing createPlanner/createRunner).
 */
export function errorTargetMigrationNotSupported(options?: {
  readonly why?: string;
}): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.TARGET_UNSUPPORTED',
    'Target does not support migrations',
    {
      why: options?.why ?? 'The configured target does not provide migration planner/runner',
      fix: 'Select a target that provides migrations (it must export `target.migrations` for db init)',
      docsUrl: docsUrlFor('MIGRATION.TARGET_UNSUPPORTED'),
    },
  );
}

/**
 * The migration-file CLI received `--config` without a path argument (either
 * a bare trailing `--config`, or `--config` followed by another flag like
 * `--config --dry-run`). Surfacing this as a structured error fails fast
 * rather than silently consuming the next flag as the config path or
 * falling back to default discovery against the wrong project.
 */
export function errorMigrationCliInvalidConfigArg(options?: {
  readonly nextToken?: string;
}): CliStructuredError {
  const why =
    options?.nextToken !== undefined
      ? `\`--config\` was followed by another flag (\`${options.nextToken}\`) instead of a path argument.`
      : '`--config` was passed without a following path argument.';
  return new CliStructuredError(
    'CLI.CONFIG_ARG_MISSING_PATH',
    '--config flag requires a path argument',
    {
      why,
      fix: 'Pass a config path: `--config <path>` or `--config=<path>`.',
      meta: options?.nextToken !== undefined ? { nextToken: options.nextToken } : {},
    },
  );
}

/**
 * The migration-file CLI received a flag it does not recognise. Surfaced as a
 * structured error so consumers can render their own "did you mean"
 * suggestions from `meta.knownFlags` rather than parsing the message.
 *
 * Designed to wrap clipanion's `UnknownSyntaxError` at the parser boundary:
 * pass the offending token as `flag` and the option declarations as
 * `knownFlags`.
 */
export function errorMigrationCliUnknownFlag(options: {
  readonly flag: string;
  readonly knownFlags: readonly string[];
}): CliStructuredError {
  const knownList = options.knownFlags.join(', ');
  return new CliStructuredError('CLI.UNKNOWN_FLAG', 'Unknown migration CLI flag', {
    why: `Unknown flag \`${options.flag}\`.`,
    fix: `Known flags: ${knownList}. Run with \`--help\` to see the full list.`,
    meta: { flag: options.flag, knownFlags: options.knownFlags },
  });
}

/**
 * The main CLI received an unsupported `--format` value.
 */
export function errorInvalidOutputFormat(value: string): CliStructuredError {
  return new CliStructuredError(
    'CLI.INVALID_OUTPUT_FORMAT',
    `Invalid --format value "${value}". Allowed values: pretty, json.`,
    {
      meta: { value, allowed: ['pretty', 'json'] as const },
    },
  );
}

/**
 * The main CLI received mutually exclusive output format flags
 * (`--format pretty` together with `--json`).
 */
export function errorOutputFormatMutex(): CliStructuredError {
  return new CliStructuredError(
    'CLI.OUTPUT_FORMAT_CONFLICT',
    'Cannot use --format pretty together with --json. Use --format json or --json alone for JSON output.',
  );
}

/**
 * Config validation error (missing required fields).
 */
export function errorConfigValidation(
  field: string,
  options?: {
    readonly why?: string;
    readonly section?: string;
  },
): CliStructuredError {
  return new CliStructuredError('CONFIG.VALIDATION_FAILED', 'Config validation error', {
    why: options?.why ?? `Config must have a "${field}" field`,
    fix: 'Check your prisma.config.ts and ensure all required fields are provided',
    docsUrl: docsUrlFor('CONFIG.VALIDATION_FAILED'),
    meta: { field, ...(options?.section !== undefined ? { section: options.section } : {}) },
  });
}

// ============================================================================
// Generic Error
// ============================================================================

/**
 * An enum declares a codecId that no component in the contract's pack stack provides,
 * so its member values cannot be encoded. Thrown by both authoring paths (TS `defineContract`
 * and PSL interpretation) when the codec lookup built from the contract's packs has no
 * descriptor for the codecId.
 */
export function errorEnumCodecNotInPackStack(options: {
  readonly codecId: string;
}): CliStructuredError {
  return new CliStructuredError(
    'CONTRACT.ENUM_CODEC_NOT_IN_PACK_STACK',
    `Enum codec "${options.codecId}" is not part of the contract's pack stack`,
    {
      why: `An enum uses codec "${options.codecId}", but no family, target, or extension pack in the contract provides it.`,
      fix: "Use a codec provided by the contract's target/extension packs, or add the pack that supplies this codec.",
      meta: { codecId: options.codecId },
    },
  );
}

/**
 * Generic unexpected error.
 */
export function errorUnexpected(
  message: string,
  options?: {
    readonly why?: string;
    readonly fix?: string;
    readonly cause?: unknown;
  },
): CliStructuredError {
  return new CliStructuredError('CLI.UNEXPECTED', 'Unexpected error', {
    why: options?.why ?? message,
    fix: options?.fix ?? 'Check the error message and try again',
    ...ifDefined('cause', options?.cause),
  });
}
