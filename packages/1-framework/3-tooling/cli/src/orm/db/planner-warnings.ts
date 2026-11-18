import type { MigrationPlannerConflict } from '@internal/framework-components/control';
import type { EngineEvent } from '@prisma/cli-engine';
import { plannerWarningText } from '../../utils/planner-warning-text';

/**
 * Collects the planner's warnings a run hands to `onPlannerWarnings`. A successful run shows them
 * in its result; a failed one reports them as `warn` messages, which come before its error.
 */
export function plannerWarningsCollector(report: (event: EngineEvent) => void) {
  let collected: readonly MigrationPlannerConflict[] = [];
  return {
    onPlannerWarnings: (warnings: readonly MigrationPlannerConflict[]): void => {
      collected = warnings;
    },
    collected: (): readonly MigrationPlannerConflict[] => collected,
    reportCollected: (): void => {
      for (const warning of collected) {
        report({ kind: 'message', severity: 'warn', text: plannerWarningText(warning) });
      }
    },
  };
}
