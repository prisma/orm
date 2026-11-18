import type { BlockingObject } from '@internal/framework-components/control';
import type { PostgresPlanTargetDetails } from './planner-target-details';

/** Postgres's error code for a statement that would remove an object others depend on. */
export const DEPENDENT_OBJECTS_STILL_EXIST = '2BP01';

const DEPENDENCY_LINE = /^(.+) (\S+) depends on /;

/** The objects Postgres's error detail says depend on what the statement removes. */
export function dependentsOf(detail: string | undefined): readonly BlockingObject[] {
  return (detail ?? '').split('\n').flatMap((line) => {
    const match = DEPENDENCY_LINE.exec(line.trim());
    const [, kind, name] = match ?? [];
    return kind === undefined || name === undefined ? [] : [{ kind, name }];
  });
}

function listed(items: readonly string[]): string {
  if (items.length === 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

/** What a runner failure says when objects the contract does not know depend on what an operation removes. */
export function dependentsSummary(
  details: PostgresPlanTargetDetails,
  label: string,
  dependents: readonly BlockingObject[],
): string {
  const named = listed(dependents.map(({ kind, name }) => `${kind} ${name}`));
  const depend = dependents.length === 1 ? 'depends' : 'depend';
  return details.objectType === 'table' && details.table === undefined
    ? `Table "${details.schema}"."${details.name}" cannot be dropped while ${named} ${depend} on it.`
    : `${label} cannot run while ${named} ${depend} on what it changes.`;
}
