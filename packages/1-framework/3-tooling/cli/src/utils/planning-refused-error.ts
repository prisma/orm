import type {
  MigrationPlannerConflict,
  ResolvedMigrationStatement,
} from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { MigrationPlanArguments } from '../control-api/operations/plan-arguments';
import { statementFlag } from '../control-api/statements/statement-flag';
import type { StatementText } from '../control-api/statements/statement-text';
import {
  ActionableCliError,
  type CliStructuredError,
  errorMigrationPlanningFailed,
} from './cli-errors';
import { chooseAction } from './next-actions';
import { type CliInvocation, printedWayToTarget, quotedPlan } from './printed-command';

/**
 * The planner's refusal as the CLI reports it. When a conflict can be written by hand, its next
 * actions are the conflicts' own advice, which says what to write, then the plan to write it in:
 * the run's statements without the ones the conflict leaves out, from and to where
 * `context.migrationPlan` says, or why no such plan exists.
 */
export function planningRefusedError(
  conflicts: readonly MigrationPlannerConflict[],
  context: {
    readonly invocation: CliInvocation;
    readonly migrationPlan: MigrationPlanArguments;
    /** The statements the run was given, in order. */
    readonly statements: readonly StatementText[];
    /** The rename, convert and backfill statements of `statements`, resolved, in the same order. */
    readonly resolved: readonly ResolvedMigrationStatement[];
  },
): CliStructuredError {
  const refused = errorMigrationPlanningFailed({ conflicts });
  const leaveOut = new Set(
    conflicts.flatMap(({ leaveOut: statements }) =>
      (statements ?? []).map((statement) => JSON.stringify(statement)),
    ),
  );
  if (leaveOut.size === 0) return refused;
  const planned = context.statements.filter(({ verb }) => verb !== 'delete' && verb !== 'allow');
  const left = planned.filter((_, index) => {
    const resolved = context.resolved[index];
    return resolved !== undefined && leaveOut.has(JSON.stringify(resolved));
  });
  const kept = context.statements.filter((statement) => !left.includes(statement));
  const plan = printedWayToTarget(
    context.invocation,
    context.migrationPlan,
    kept.map(statementFlag),
  );
  const action = chooseAction(
    plan.kind === 'on-disk'
      ? `${plan.reason}. To write the rewrites by hand, add the rewrites the message describes to the migration.ts of the one that makes the change, run that migration.ts with \`node\`, and apply them with \`${plan.apply}\``
      : plan.kind === 'none' || plan.kind === 'at-target'
        ? `The rewrites cannot be written by hand in a migration. ${plan.reason}`
        : `To write the rewrites by hand, plan the change without ${left.map(statementFlag).join(' and ')} with ${quotedPlan(plan)}, add the rewrites the message describes to the migration.ts it writes, ${plan.afterPlan}`,
  );
  const reasons = conflicts.flatMap(({ why }) => (why === undefined ? [] : [why]));
  return new ActionableCliError(refused.code, refused.message, {
    why: refused.why,
    fix: refused.fix ?? action.label,
    nextActions: [...(reasons.length === 0 ? [] : [chooseAction(reasons.join('\n'))]), action],
    ...ifDefined('meta', refused.meta),
    ...ifDefined('docsUrl', refused.docsUrl),
  });
}
