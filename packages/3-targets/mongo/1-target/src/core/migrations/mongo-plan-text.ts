import {
  type FieldCoordinate,
  type ModelCoordinate,
  modelDisplayName,
} from '@internal/framework-components/control';

/** Joins items into text: "a", "a and b", "a, b and c". */
export function joinedList(items: readonly string[]): string {
  return items.length === 1
    ? (items[0] ?? '')
    : `${items.slice(0, -1).join(', ')} and ${items.at(-1)}`;
}

function namedList(noun: string, names: readonly string[]): string {
  return `${noun}${names.length === 1 ? '' : 's'} ${joinedList(names.map((name) => `"${name}"`))}`;
}

export function modelsText(models: readonly ModelCoordinate[]): string {
  return namedList('model', models.map(modelDisplayName));
}

export function fieldDisplayName(field: FieldCoordinate): string {
  return `${modelDisplayName(field)}.${field.field}`;
}

export function capitalized(text: string): string {
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}`;
}

/** The steps of a migration the user writes by hand, which rewrites `what` with the other operations of the change. */
export function handWrittenMigrationSteps(what: string): string {
  return `run prisma migration new, and in the operations of the migration.ts it writes, rewrite ${what} yourself, with the other operations of the change. Then run that migration.ts to emit its ops.json.`;
}

/** Why a MongoDB plan must be safe to run again: its operations run one at a time, and only the documents say which ran. */
export const ONE_AT_A_TIME =
  "MongoDB applies a migration's operations one at a time, without a transaction, and knows that an operation already ran only from the documents.";

/** The route for keeping data a plan cannot keep: a hand-written migration, which only `migration plan` users write. */
export function handWrittenRoute(what: string): string {
  return `With migration plan, write this change as a hand-written migration instead: ${handWrittenMigrationSteps(what)}`;
}
