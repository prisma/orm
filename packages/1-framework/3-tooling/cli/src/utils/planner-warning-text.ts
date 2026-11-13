import type { MigrationPlannerConflict } from '@internal/framework-components/control';

/** A planner warning as the CLI prints it: its summary, then its why. */
export function plannerWarningText(warning: MigrationPlannerConflict): string {
  if (warning.why === undefined) return warning.summary;
  const summary = /[.!?]$/.test(warning.summary) ? warning.summary : `${warning.summary}.`;
  return `${summary} ${warning.why}`;
}
