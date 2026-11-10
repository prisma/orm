import type { MigrationPlannerConflict } from '@internal/framework-components/control';
import type { EngineEvent } from '@prisma/cli-engine';
import { plannerWarningText } from '../../utils/planner-warning-text';

/**
 * Reports each planner warning a run hands to `onPlannerWarnings` as a `warn` message when the
 * planner returns it, before the apply, and keeps them for a successful run's result.
 */
export function plannerWarningsCollector(report: (event: EngineEvent) => void) {
  let collected: readonly MigrationPlannerConflict[] = [];
  return {
    onPlannerWarnings: (warnings: readonly MigrationPlannerConflict[]): void => {
      collected = warnings;
      for (const warning of warnings) {
        report({ kind: 'message', severity: 'warn', text: plannerWarningText(warning) });
      }
    },
    collected: (): readonly MigrationPlannerConflict[] => collected,
  };
}
