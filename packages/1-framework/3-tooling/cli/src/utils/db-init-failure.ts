import type { MigrationOperationClass } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import { assertNever } from '@internal/utils/internal-error';
import type { NextAction } from '@prisma/cli-engine/protocol';
import { DB_UPDATE_POLICY } from '../control-api/operations/db-update';
import type { DbInitFailure } from '../control-api/types';
import type { CliStructuredError } from './cli-errors';
import {
  ActionableCliError,
  errorMigrationPlanningFailed,
  errorRunnerFailed,
  errorRuntime,
} from './cli-errors';
import { runCommandAction } from './next-actions';

const DB_INIT_ADDITIVE_ONLY_FIX =
  '`db init` applies only additive changes. Run `{bin} db update`, which also applies widening and destructive ones after you confirm them by typing the database name, or pass `--no-interactive --confirm <database>` where there is nobody to ask.';

const DB_INIT_NEEDS_MIGRATION_FIX =
  '`db init` applies only additive changes, and `db update` does not apply data operations. Plan a migration with `{bin} migration plan`, which can include them, and apply it with `{bin} db migrate`.';

/**
 * What to do instead of `db init` when its additive-only policy refused operations of the given classes: `db update` when its policy allows all of them, otherwise a planned migration.
 */
function adviceForRefusedClasses(refused: ReadonlySet<MigrationOperationClass>): {
  readonly fix: string;
  readonly nextAction: NextAction;
} {
  const allowedByDbUpdate: ReadonlySet<MigrationOperationClass> = new Set(
    DB_UPDATE_POLICY.allowedOperationClasses,
  );
  if (![...refused].every((operationClass) => allowedByDbUpdate.has(operationClass))) {
    return {
      fix: DB_INIT_NEEDS_MIGRATION_FIX,
      nextAction: runCommandAction(
        'Plan a migration, since db update does not apply data operations',
        '{bin} migration plan',
      ),
    };
  }
  return {
    fix: DB_INIT_ADDITIVE_ONLY_FIX,
    nextAction: runCommandAction(
      refused.has('destructive')
        ? 'Apply the change with db update, which lists the destructive operations and asks you to confirm them'
        : 'Apply the change with db update',
      '{bin} db update',
    ),
  };
}

function markerMismatchDetail(failure: DbInitFailure): string {
  const parts: string[] = [];
  if (
    failure.marker?.storageHash !== failure.destination?.storageHash &&
    failure.marker?.storageHash &&
    failure.destination?.storageHash
  ) {
    parts.push(
      `storageHash (marker: ${failure.marker.storageHash}, destination: ${failure.destination.storageHash})`,
    );
  }
  if (
    failure.marker?.profileHash !== failure.destination?.profileHash &&
    failure.marker?.profileHash &&
    failure.destination?.profileHash
  ) {
    parts.push(
      `profileHash (marker: ${failure.marker.profileHash}, destination: ${failure.destination.profileHash})`,
    );
  }
  return parts.length > 0 ? ` Mismatch in ${parts.join(' and ')}.` : '';
}

/**
 * A `db init` failure as the CLI's structured error.
 *
 * The `assertNever` is deliberate: a control-API failure code this does not
 * handle must stop the command rather than degrade into a generic message.
 */
export function mapDbInitFailure(failure: DbInitFailure): CliStructuredError {
  if (failure.code === 'PLANNING_FAILED') {
    const conflicts = failure.conflicts ?? [];
    const planningFailed = errorMigrationPlanningFailed({ conflicts });
    const refused = new Set(
      conflicts.flatMap((conflict) =>
        conflict.refusedOperationClass === undefined ? [] : [conflict.refusedOperationClass],
      ),
    );
    if (refused.size === 0) {
      return planningFailed;
    }
    const { fix, nextAction } = adviceForRefusedClasses(refused);
    return new ActionableCliError(planningFailed.code, planningFailed.message, {
      why: planningFailed.why ?? '',
      fix,
      nextActions: [nextAction],
      ...ifDefined('meta', planningFailed.meta),
      ...ifDefined('docsUrl', planningFailed.docsUrl),
    });
  }

  if (failure.code === 'MIGRATION.MARKER_ORIGIN_MISMATCH') {
    return errorRuntime(
      'MIGRATION.MARKER_ORIGIN_MISMATCH',
      `Existing database signature does not match plan destination.${markerMismatchDetail(failure)}`,
      {
        why: 'Database has an existing signature (marker) that does not match the target contract',
        fix: 'If bootstrapping, drop/reset the database then re-run `{bin} db init`; otherwise reconcile schema/marker using your migration workflow',
        meta: {
          ...ifDefined('markerStorageHash', failure.marker?.storageHash),
          ...ifDefined('destinationStorageHash', failure.destination?.storageHash),
          ...ifDefined('markerProfileHash', failure.marker?.profileHash),
          ...ifDefined('destinationProfileHash', failure.destination?.profileHash),
        },
      },
    );
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
        : 'Fix the schema mismatch (db init is additive-only), or drop/reset the database and re-run `{bin} db init`';
    return errorRunnerFailed(failure.summary, {
      why: failure.why ?? 'Migration runner failed',
      fix,
      ...ifDefined('meta', failure.meta),
      ...ifDefined('cause', failure.cause),
    });
  }

  const exhaustive: never = failure.code;
  return assertNever(exhaustive, `Unhandled DbInitFailure code: ${String(exhaustive)}`);
}
