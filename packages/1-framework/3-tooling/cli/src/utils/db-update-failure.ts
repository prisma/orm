import { ifDefined } from '@internal/utils/defined';
import { assertNever } from '@internal/utils/internal-error';
import type { DbUpdateFailure } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import {
  errorConsentPlanMismatch,
  errorDestructiveChanges,
  errorMigrationPlanningFailed,
  errorRunnerFailed,
} from './cli-errors';

/**
 * A `db update` failure as the CLI's structured error.
 *
 * `DESTRUCTIVE_CHANGES` is handled by the command, which asks for consent and
 * calls again; it is mapped here for the case the control API returns it from a
 * call that already carried consent, which would otherwise degrade silently.
 *
 * The `assertNever` is deliberate: a control-API failure code this does not
 * handle must stop the command rather than degrade into a generic message.
 */
export function mapDbUpdateFailure(failure: DbUpdateFailure): CliStructuredError {
  if (failure.code === 'PLANNING_FAILED') {
    return errorMigrationPlanningFailed({ conflicts: failure.conflicts ?? [] });
  }

  if (failure.code === 'RUNNER_FAILED') {
    const runnerCode =
      typeof failure.meta?.['runnerErrorCode'] === 'string'
        ? failure.meta['runnerErrorCode']
        : undefined;
    const fix =
      runnerCode === 'MIGRATION.LEGACY_MARKER_SHAPE'
        ? // biome-ignore lint/plugin/no-family-vocabulary: names the object to drop per target on purpose — user-facing remediation text, not a framework type
          'Legacy marker-table shape detected. Drop `prisma_contract.marker` (Postgres) or `_prisma_marker` (SQLite) and re-run `{bin} db init` to recreate it with the current per-space schema.'
        : 'Inspect the reported conflict, reconcile schema drift if needed, then re-run `{bin} db update`';
    return errorRunnerFailed(failure.summary, {
      why: failure.why ?? 'Migration runner failed',
      fix,
      meta: {
        ...failure.meta,
        ...(failure.warnings && failure.warnings.length > 0
          ? { plannerWarnings: failure.warnings }
          : {}),
      },
      ...ifDefined('cause', failure.cause),
    });
  }

  if (failure.code === 'DESTRUCTIVE_CHANGES') {
    return errorDestructiveChanges(failure.summary, {
      ...ifDefined('why', failure.why),
      fix: 'Re-run `{bin} db update` and type the database name when asked, or pass `--no-interactive --confirm <database>` where there is nobody to ask. Use `--dry-run` to preview the operations first.',
      ...(failure.destructiveChanges
        ? {
            meta: {
              destructiveOperations: failure.destructiveChanges.destructiveOperations,
              databaseName: failure.destructiveChanges.databaseName,
              planHash: failure.destructiveChanges.planHash,
            },
          }
        : {}),
    });
  }

  if (failure.code === 'CONSENT_PLAN_MISMATCH') {
    return errorConsentPlanMismatch({
      consentedPlanHash: failure.consentPlanMismatch?.consentedPlanHash ?? '',
      planHash: failure.consentPlanMismatch?.planHash ?? '',
      ...ifDefined('why', failure.why),
    });
  }

  const exhaustive: never = failure.code;
  return assertNever(exhaustive, `Unhandled DbUpdateFailure code: ${String(exhaustive)}`);
}
