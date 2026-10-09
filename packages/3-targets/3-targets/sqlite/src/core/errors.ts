import { CliStructuredError } from '@internal/errors/control';
import type { StructuredError, StructuredErrorOptions } from '@internal/utils/structured-error';
import { structuredError } from '@internal/utils/structured-error';

export type SqliteTargetErrorCode =
  | 'CONTRACT.ARGUMENT_INVALID'
  | 'CONTRACT.CONSTRAINT_INVALID'
  | 'CONTRACT.DEFAULT_INVALID'
  | 'CONTRACT.IDENTIFIER_INVALID'
  | 'CONTRACT.NAMESPACE_INVALID'
  | 'CONTRACT.TARGET_MISMATCH'
  | 'CONTRACT.TYPE_UNKNOWN'
  | 'MIGRATION.CONTRACT_SPACE_VIOLATION'
  | 'MIGRATION.SQLITE_CONTROL_STACK_MISSING'
  | 'MIGRATION.TARGET_MISMATCH'
  | 'RUNTIME.DECODE_FAILED'
  | 'RUNTIME.ENCODE_FAILED';

export function sqliteError(
  code: SqliteTargetErrorCode,
  message: string,
  options?: StructuredErrorOptions,
): StructuredError {
  return structuredError(code, message, options);
}

/**
 * A `SqliteMigration` operation that needs the materialized control adapter
 * — named by `operation` (e.g. `createTable`, `dropColumn`, `recreateTable`) —
 * was invoked, but the migration was constructed without a `ControlStack`.
 * Concrete authoring usage always goes through the migration CLI entrypoint,
 * which assembles a stack from the loaded `prisma.config.ts`; reaching this
 * error means a test fixture or ad-hoc consumer instantiated `SqliteMigration`
 * with the no-arg form (legal for `operations` / `describe` introspection only).
 *
 * The `operation` argument is required so every throw site names the operation
 * that actually failed; a new operation cannot inherit a misattributed message.
 *
 * Distinct from `MIGRATION.UNFILLED_PLACEHOLDER` (placeholder not filled)
 * because the missing input is the stack itself, not the per-operation
 * contract.
 *
 * Lives in `@internal/target-sqlite/errors` rather than the shared
 * framework migration errors module because the failure is target-specific:
 * the contract it talks about (`SqliteMigration`, the SQLite control
 * adapter, the SQLite-target stack) only exists in this package.
 */
export function errorSqliteMigrationStackMissing(operation: string): CliStructuredError {
  return new CliStructuredError(
    'MIGRATION.SQLITE_CONTROL_STACK_MISSING',
    `SqliteMigration.${operation} requires a control adapter`,
    {
      why: `SqliteMigration.${operation} was invoked on an instance constructed without a ControlStack, so the stored controlAdapter is undefined and the operation cannot lower its DDL node.`,
      fix: 'Construct the migration via the migration CLI entrypoint (which assembles a ControlStack from the loaded prisma.config.ts), or pass a ControlStack containing a SQLite adapter to the migration constructor in test fixtures.',
      meta: { operation },
    },
  );
}
