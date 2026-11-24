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

/** The names, quoted, in a list joined with "and". */
export function quotedList(names: readonly string[]): string {
  return joinedList(names.map((name) => JSON.stringify(name)));
}

function namedList(noun: string, names: readonly string[]): string {
  return `${noun}${names.length === 1 ? '' : 's'} ${quotedList(names)}`;
}

/** Model names in one namespace, with "model" or "models" before them. */
export function modelNamesText(names: readonly string[]): string {
  return namedList('model', names);
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

/** A move of one or more models' documents to another collection, which a plan cannot write because no filter of its own selects them. */
export interface DocumentMove {
  /** The models whose documents move, in words. */
  readonly moving: string;
  readonly from: string;
  readonly to: string;
  /** Whether the plan creates collection `to`; when it already exists the plan has no creation to place the move after. */
  readonly created: boolean;
}

/**
 * The steps that add a document move to the migration.ts a plan writes: the operations, where they
 * go (right after the creation of the new collection, or first when the collection already exists,
 * so no later rewrite of the old collection reaches the documents first), the filter they need, and
 * what to do if the apply stops.
 */
export function documentMoveSteps({ moving, from, to, created }: DocumentMove): string {
  const placement = created
    ? `in the operations of the migration.ts it writes, right after the creation of collection "${to}" and before any other operation on collection "${from}"`
    : `at the start of the operations of the migration.ts it writes, before any other operation on collection "${from}"`;
  return `${placement}, add a dataTransform whose run copies the documents of ${moving} into collection "${to}", such as rawAggregate(${JSON.stringify(from)}, [{ $match: <a filter that selects only those documents> }, { $merge: { into: ${JSON.stringify(to)} } }]), and a deleteDocuments({ collection: ${JSON.stringify(from)}, filter: <the same filter> }); then run that migration.ts to emit its ops.json, and apply it with db migrate. This works only when a filter can tell those documents apart from the other documents of collection "${from}", which can hold the same values in the fields they share, such as a discriminator value: filter by a field only ${moving} stores. If the apply stops, fix what stopped it and run db migrate again.`;
}
