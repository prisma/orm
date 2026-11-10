import type { MigrationPlannerConflict } from '@internal/framework-components/control';
import type { EngineEvent } from '@prisma/cli-engine';

/**
 * Collects the planner's warnings a run hands to `onPlannerWarnings`. A failed run reports them as
 * `warn` messages, which reach the human and the `--json` output; a successful one lists them in
 * its result.
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
        report({ kind: 'message', severity: 'warn', text: warning.summary });
      }
    },
  };
}
