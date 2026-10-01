import { CliStructuredError } from './control';

// ============================================================================
// Migration Errors (MIGRATION.*)
//
// Errors raised by the migration subsystem (authoring, planning, emit). See
// ADR 239 for the namespace taxonomy.
// ============================================================================

/**
 * A scaffolded migration contains a placeholder slot that was never filled in.
 *
 * Thrown at emit time (when `check.source()` or `run()` is invoked) via the
 * `placeholder(...)` utility. The `slot` identifies the exact location the
 * author still needs to edit, e.g. `"backfill-product-status:check.source"`.
 */
export function errorUnfilledPlaceholder(slot: string): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.UNFILLED_PLACEHOLDER',
    'Unfilled migration placeholder',
    {
      why: `The migration contains a placeholder that has not been filled in: ${slot}`,
      fix: 'Open migration.ts and replace the `placeholder(...)` call with your actual query.',
      meta: { slot },
    },
  );
}

/**
 * Scaffolded `migration.ts` files call this wherever the scaffolder couldn't
 * emit a real query and the author is expected to fill one in. Always throws
 * a structured migration error (`MIGRATION.UNFILLED_PLACEHOLDER`).
 *
 * The return type `never` makes it assignable to any expected return type, so
 * a scaffolded `() => placeholder('...')` satisfies signatures like
 * `() => MongoQueryPlan` without polluting them with a sentinel union arm.
 */
export function placeholder(slot: string): never {
  throw errorUnfilledPlaceholder(slot);
}

/**
 * A `dataTransform(endContract, …)` factory was handed a `SqlQueryPlan` whose
 * `meta.storageHash` does not match the `endContract.storage.storageHash` it
 * was configured with. This almost always means the user's query-builder
 * (`sql({ context: createExecutionContext({ contract: endContract, … }) })`)
 * was instantiated from a different contract reference than the one passed
 * to `dataTransform(endContract, …)`.
 *
 * Distinct from `errorHashMismatch` (`CONTRACT.MARKER_MISMATCH`) which
 * rejects a plan at runtime execution; this is an authoring-time rejection
 * so it lives in the `MIGRATION` namespace.
 */
export function errorDataTransformContractMismatch(options: {
  readonly dataTransformName: string;
  readonly expected: string;
  readonly actual: string;
}): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.DATA_TRANSFORM_CONTRACT_MISMATCH',
    'dataTransform query plan built against wrong contract',
    {
      why: `Data transform "${options.dataTransformName}" produced a query plan whose storage hash (${options.actual}) does not match the migration's contract (${options.expected}). The query builder was configured with a different contract than the one passed to dataTransform(endContract, ...).`,
      fix: 'Ensure the `endContract` imported at module scope (used for both `dataTransform(endContract, …)` and `sql({ context: createExecutionContext({ contract: endContract, … }) })`) is the same reference.',
      meta: {
        dataTransformName: options.dataTransformName,
        expected: options.expected,
        actual: options.actual,
      },
    },
  );
}

/**
 * `migration.ts` was expected at the given package directory but could not be
 * located. Thrown when consumers attempt to read a migration package that is
 * missing its source file.
 */
export function errorMigrationFileMissing(dir: string): CliStructuredError {
  return new CliStructuredError('MIGRATION.FILE_MISSING', 'migration.ts not found', {
    why: `No migration.ts file was found at "${dir}"`,
    fix: 'Scaffold one with `{bin} migration new` or `{bin} migration plan`.',
    nextActions: [
      { kind: 'run-command', label: 'Scaffold an empty migration', command: '{bin} migration new' },
      {
        kind: 'run-command',
        label: 'Scaffold a migration from a contract diff',
        command: '{bin} migration plan',
      },
    ],
    meta: { dir },
  });
}

/**
 * The `migration.ts` at the given package directory does not default-export a
 * valid migration shape. Two shapes are accepted: a `Migration` subclass, or a
 * factory function returning a `MigrationPlan`-shaped object (with at least
 * an `operations` array, plus `targetId` and `destination`). Thrown when the
 * default export is missing, is not a constructor/function, does not extend
 * `Migration`, or (for factory functions) returns a value that is not
 * `MigrationPlan`-shaped.
 */
export function errorMigrationInvalidDefaultExport(
  dir: string,
  actualExportDescription?: string,
): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.INVALID_DEFAULT_EXPORT',
    'migration.ts default export is not a valid migration',
    {
      why:
        actualExportDescription !== undefined
          ? `migration.ts at "${dir}" must default-export a Migration subclass or a factory function returning a MigrationPlan-shaped object; got ${actualExportDescription}`
          : `migration.ts at "${dir}" must default-export a Migration subclass or a factory function returning a MigrationPlan-shaped object.`,
      fix: 'Use `export default class extends Migration { ... }` or `export default () => ({ targetId, destination, operations })`.',
      meta: {
        dir,
        ...(actualExportDescription !== undefined ? { actualExport: actualExportDescription } : {}),
      },
    },
  );
}

/**
 * The migration class declares one `targetId` but the loaded
 * `prisma.config.ts` declares another. Thrown by `MigrationCLI.run`
 * when a migration script is invoked against a config whose target
 * descriptor disagrees with the migration's own `targetId`. Distinct from generic
 * config-validation errors because the mismatch is between two valid
 * artifacts (the script and the config), not a malformed input.
 */
export function errorMigrationTargetMismatch(options: {
  readonly migrationTargetId: string;
  readonly configTargetId: string;
}): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.TARGET_MISMATCH',
    'Migration target does not match config target',
    {
      why: `This migration is for target "${options.migrationTargetId}" but the loaded prisma.config.ts declares target "${options.configTargetId}". The migration script can only be run against a config that targets the same database.`,
      fix: "Switch to a config whose `target` matches the migration's target, or pass `--config <path>` to point at the right config file.",
      meta: {
        migrationTargetId: options.migrationTargetId,
        configTargetId: options.configTargetId,
      },
    },
  );
}

/**
 * A `Migration.operations` getter returned a value that is not an array. Used
 * by emit capabilities after instantiating the authored migration.
 */
export function errorMigrationPlanNotArray(
  dir: string,
  actualValueDescription?: string,
): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.PLAN_NOT_ARRAY',
    'Migration.operations must be an array of operations',
    {
      why:
        actualValueDescription !== undefined
          ? `Migration.operations for migration.ts at "${dir}" was ${actualValueDescription}; an array of operations is required.`
          : `Migration.operations for migration.ts at "${dir}" is not an array of operations.`,
      fix: 'Ensure your `operations` getter returns an array of operations; see the data-migrations authoring guide.',
      meta: {
        dir,
        ...(actualValueDescription !== undefined ? { actualValue: actualValueDescription } : {}),
      },
    },
  );
}

const UPGRADE_GUIDES_URL = 'https://github.com/prisma/orm/tree/main/skills/prisma-8/upgrading';

/**
 * A `migration.ts` passes an operation an option in the form an earlier version wrote, which this version no longer reads. `node migration.ts` strips types without checking them, so such a file runs; the operation refuses the option rather than leave out what it carries. `subject` names what the option was for, `rewrite` says how to write it now, and `upgradeEntry` is the id of the upgrade entry that shows the new form.
 */
export function errorMigrationOperationOptionRemoved(options: {
  readonly operation: string;
  readonly option: string;
  readonly subject: string;
  readonly rewrite: string;
  readonly upgradeEntry: string;
}): CliStructuredError {
  const { operation, option, upgradeEntry } = options;
  return new CliStructuredError(
    'MIGRATION.OPERATION_OPTION_REMOVED',
    `\`${operation}\` in migration.ts passes \`${option}\`, which this version no longer reads, for ${options.subject}`,
    {
      why: 'An earlier version wrote this migration.ts. `node migration.ts` does not check its types, so the file runs, and this version would leave out what the option carries.',
      fix: `${options.rewrite} Or, if the migration is not applied, delete its package and run \`migration plan\` again. The upgrade entry \`${upgradeEntry}\` shows the new shape: ${UPGRADE_GUIDES_URL}`,
      meta: { operation, option, upgradeEntry },
    },
  );
}
