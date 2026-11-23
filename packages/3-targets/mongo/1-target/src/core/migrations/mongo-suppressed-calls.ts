import type { MigrationPlannerConflict } from '@internal/framework-components/control';
import { ifDefined } from '@internal/utils/defined';
import type { CollectionControl } from './mongo-statement-planning';
import type { OpFactoryCall } from './op-factory-call';

/**
 * The warning for a change a collection's control policy left out of the plan, worded as the Postgres planner words a suppressed call.
 */
export function suppressedCallWarning(
  call: OpFactoryCall,
  collection: string,
  control: CollectionControl,
): MigrationPlannerConflict & { readonly meta: Record<string, string> } {
  const declared =
    control.declared !== undefined && control.declared !== control.policy
      ? ` but declared '${control.declared}'`
      : '';
  return {
    kind: 'controlPolicySuppressedCall',
    summary: `control policy suppressed: ${call.label} — collection "${collection}" has effective control '${control.policy}'${declared}`,
    meta: {
      controlPolicy: control.policy,
      ...ifDefined('declaredControlPolicy', control.declared),
    },
  };
}
