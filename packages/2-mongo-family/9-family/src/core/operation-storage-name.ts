import type { MigrationPlanOperation } from '@internal/framework-components/control';

function collectionOfStep(step: unknown): string | undefined {
  if (typeof step !== 'object' || step === null) return undefined;
  const command: unknown = Reflect.get(step, 'command');
  if (typeof command !== 'object' || command === null) return undefined;
  const collection: unknown = Reflect.get(command, 'collection');
  return typeof collection === 'string' ? collection : undefined;
}

/**
 * The collection an operation's command names, as the database knows it: the name the Mongo
 * planner gives a dropped collection. An operation whose commands name no collection is named by
 * its id.
 */
export function mongoStorageNameOf(operation: MigrationPlanOperation): string {
  const execute: unknown = Reflect.get(operation, 'execute');
  const steps: readonly unknown[] = Array.isArray(execute) ? execute : [];
  for (const step of steps) {
    const collection = collectionOfStep(step);
    if (collection !== undefined) return collection;
  }
  return operation.id;
}
