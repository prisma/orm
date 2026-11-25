import {
  type FieldCoordinate,
  type ModelCoordinate,
  modelDisplayName,
} from '@internal/framework-components/control';
import type { DocumentCopy, DocumentMove } from './mongo-document-moves';

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

function movingText({ copies }: DocumentMove): string {
  return modelNamesText(copies.flatMap((copy) => copy.models));
}

function placementOf({ to, order }: DocumentMove): string {
  const before = `before any other operation on collection "${order.source}"`;
  switch (order.after?.kind) {
    case 'createCollection':
      return `in the operations of the migration.ts it writes, right after the creation of collection "${to}" and ${before}`;
    case 'renameCollection':
      return `in the operations of the migration.ts it writes, right after the ${joinedList(order.after.renames.map((rename) => `rename of collection "${rename.from}" to "${rename.to}"`))} and ${before}`;
    case undefined:
      return `at the start of the operations of the migration.ts it writes, ${before}`;
  }
}

function bypassText({ to, order }: DocumentMove): string {
  switch (order.validatorChange) {
    case 'replaced':
      return ` The copy skips document validation because collection "${to}" still has its old validator; the later validator update on "${to}" checks the moved documents. If that check stops the apply, the moved documents are in collection "${to}": fix them there and run db migrate again.`;
    case 'removed':
      return ` The copy skips document validation because collection "${to}" still has its old validator, which the plan then removes.`;
    case undefined:
      return '';
  }
}

function copyCall(move: DocumentMove, copy: DocumentCopy, selects: string): string {
  const pipeline = [
    `{ $match: <a filter that selects only ${selects}> }`,
    ...copy.fieldStages.map((stage) => JSON.stringify(stage)),
    `{ $merge: { into: ${JSON.stringify(move.to)} } }`,
  ].join(', ');
  const bypass = move.order.bypassDocumentValidation ? ', { bypassDocumentValidation: true }' : '';
  return `rawAggregate(${JSON.stringify(move.order.source)}, [${pipeline}]${bypass})`;
}

function operationsText(move: DocumentMove): string {
  const { to, copies } = move;
  const from = move.order.source;
  const [only] = copies;
  const copiesText =
    copies.length === 1 && only !== undefined
      ? `copies the documents of ${movingText(move)} into collection "${to}", such as ${copyCall(move, only, 'those documents')}, and a deleteDocuments({ collection: ${JSON.stringify(from)}, filter: <the same filter> })`
      : `copies the documents of ${movingText(move)} into collection "${to}", one copy for each group of models whose documents change alike on the way, such as ${joinedList(copies.map((copy) => `${copyCall(move, copy, `the documents of ${modelNamesText(copy.models)}`)} for ${modelNamesText(copy.models)}`))}, and a deleteDocuments({ collection: ${JSON.stringify(from)}, filter: <a filter that selects the documents of all of them> })`;
  return `add a dataTransform whose run ${copiesText}; then run that migration.ts to emit its ops.json, and apply it with db migrate.`;
}

function filterText(move: DocumentMove): string {
  const moving = movingText(move);
  return `This works only when a filter can tell those documents apart from the other documents of collection "${move.order.source}", which can hold the same values in the fields they share, such as a discriminator value: filter by a field only ${moving} stores. If the apply stops, fix what stopped it and run db migrate again.`;
}

/**
 * The steps that add a document move to the migration.ts a plan writes, after `plan`, the step that
 * plans it, when one is given: the operations, where they go (see `documentMoveOrder`), the filter
 * they need, and what to do if the apply stops. The target's rewrites come after the move: those of
 * another model that would reach the moved documents are refused, and those of a moving model reach
 * them, as they should.
 */
export function documentMoveSteps(move: DocumentMove, plan?: string): string {
  const steps = `${placementOf(move)}, ${operationsText(move)}${bypassText(move)} ${filterText(move)}`;
  return plan === undefined ? steps : `${plan}, and ${steps}`;
}
