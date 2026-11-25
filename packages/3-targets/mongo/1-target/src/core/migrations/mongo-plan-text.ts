import {
  type FieldCoordinate,
  type ModelCoordinate,
  modelDisplayName,
} from '@internal/framework-components/control';
import { jsonToTsSource } from '@internal/ts-render';
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

/** Where the move's dataTransforms go, as a clause that starts in lower case so it can follow "For model …,". */
function placementClause({ from, to, order }: DocumentMove): string {
  const before = `before the plan's own operations on collection "${from}"`;
  switch (order.after?.kind) {
    case 'createCollection':
      return `in the operations of the migration.ts it writes, right after the creation of collection "${to}" and ${before}`;
    case 'renameCollection':
      return `in the operations of the migration.ts it writes, right after the ${joinedList(order.after.renames.map((rename) => `rename of collection "${rename.from}" to "${rename.to}"`))} and ${before}`;
    case undefined:
      return `at the start of the operations of the migration.ts it writes, ${before}`;
  }
}

function bypassText({ to, order, copies }: DocumentMove): string {
  const skips = `${copies.length === 1 ? 'The copy skips' : 'The copies skip'} document validation because collection "${to}" still has its old validator`;
  switch (order.validatorChange) {
    case 'replaced':
      return ` ${skips}; the later validator update on "${to}" checks the moved documents.`;
    case 'removed':
      return ` ${skips}, which the plan then removes.`;
    case undefined:
      return '';
  }
}

/**
 * `jsonToTsSource`'s text on one line. Its line breaks are layout only, since it escapes those
 * inside strings, so joining them keeps the value and gives the layout it uses for a short value.
 */
function oneLine(source: string): string {
  return source
    .replace(/([{[])\n\s*/g, (_, open: string) => (open === '{' ? '{ ' : '['))
    .replace(/,\n\s*([}\]])/g, (_, close: string) => (close === '}' ? ' }' : ']'))
    .replace(/,\n\s*/g, ', ');
}

const CODE_INDENT = '  ';

/** A `rawAggregate` call of the move as it goes in `migration.ts`, one stage to a line. */
function copyCall(move: DocumentMove, copy: DocumentCopy, selects: string): string {
  const stages = [
    `{ $match: <a filter that selects only ${selects}> }`,
    ...[...copy.fieldStages, { $merge: { into: move.to } }].map((stage) =>
      oneLine(jsonToTsSource(stage)),
    ),
  ];
  const bypass = move.order.bypassDocumentValidation
    ? `, ${jsonToTsSource({ bypassDocumentValidation: true })}`
    : '';
  return [
    `${CODE_INDENT}rawAggregate(${jsonToTsSource(move.from)}, [`,
    ...stages.map((stage) => `${CODE_INDENT}${CODE_INDENT}${stage},`),
    `${CODE_INDENT}]${bypass})`,
  ].join('\n');
}

/**
 * The dataTransforms of a move, one for each copy, since a dataTransform's run is one query plan,
 * and after them the delete, which is an operation of its own.
 */
function copiesText(move: DocumentMove): string {
  const { from, to, copies } = move;
  const [only] = copies;
  const deleteCall = (filter: string) =>
    `${CODE_INDENT}deleteDocuments({ collection: ${jsonToTsSource(from)}, filter: ${filter} })`;
  const deletes = `the operation that deletes the documents of ${movingText(move)} from collection "${from}"`;
  return copies.length === 1 && only !== undefined
    ? `add a dataTransform. Its run copies the documents of ${movingText(move)} into collection "${to}":\n\n${copyCall(move, only, 'those documents')}\n\nAfter it, add ${deletes}:\n\n${deleteCall('<the same filter>')}`
    : `add one dataTransform for each group of models whose documents change alike on the way into collection "${to}". The run of each is one of these copies:\n\n${copies.map((copy) => copyCall(move, copy, `the documents of ${modelNamesText(copy.models)}`)).join('\n\n')}\n\nAfter them, add ${deletes}:\n\n${deleteCall('<a filter that selects the documents of all of them>')}`;
}

function droppedText({ copies }: DocumentMove): string {
  return copies
    .filter((copy) => copy.droppedStoredNames.length > 0)
    .map((copy) => {
      const one = copy.droppedStoredNames.length === 1;
      return ` ${copies.length === 1 ? 'Its' : `The copy of ${modelNamesText(copy.models)}: its`} $unset stage deletes field${one ? '' : 's'} ${quotedList(copy.droppedStoredNames)} and ${one ? 'its' : 'their'} values from the moved documents, since the model they become does not store ${one ? 'it' : 'them'}.`;
    })
    .join('');
}

function filterText(move: DocumentMove): string {
  const shared = `the other documents of collection "${move.from}", which can hold the same values in the fields they share, a discriminator value among them`;
  return move.copies.length === 1
    ? `The filter must tell those documents apart from ${shared}. Filter by a field only ${movingText(move)} ${move.copies[0]?.models.length === 1 ? 'stores' : 'store'}.`
    : `Each copy's filter must select only the documents of its own models, apart from those of the other models that move and from ${shared}. Filter each copy by a field only its models store.`;
}

function moveText(move: DocumentMove, naming: boolean): string {
  const placement = naming
    ? `For ${movingText(move)}, ${placementClause(move)},`
    : `${capitalized(placementClause(move))},`;
  return `${placement} ${copiesText(move)}\n\n${filterText(move)}${droppedText(move)}${bypassText(move)}`;
}

function applyText(count: number): string {
  return count === 1
    ? 'Run that migration.ts to emit its ops.json, and apply it with db migrate.'
    : `${count === 2 ? 'Both' : `All ${count}`} dataTransforms go in that one migration.ts. Run it to emit its ops.json, and apply it once with db migrate.`;
}

/** What the user must hold while a hand-written move runs, since its copy and delete are two operations with no transaction, and `$merge` matches by `_id`. */
const MOVE_LIMITS =
  'Stop writes to each collection the documents move out of until the apply ends: the delete also removes a document of those models written there after the copy, and that document was not copied. $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections.';

function stopText(moves: readonly DocumentMove[]): string {
  const checked = moves.filter((move) => move.order.validatorChange === 'replaced');
  return `If the apply stops, fix what stopped it and run db migrate again.${checked
    .map(
      ({ to }) =>
        ` If the validator update on "${to}" stops it, the moved documents are in collection "${to}": fix them there.`,
    )
    .join('')}`;
}

/**
 * The steps that add document moves to the migration.ts a plan writes, in short paragraphs: for
 * each move, where its dataTransforms go (see `documentMoveOrder`) with its copies and delete, and
 * the filter they need; then how to apply them, together, and what to do if the apply stops. With
 * several moves, each starts with the models that move. The target's rewrites come after the move:
 * those of another model that would reach the moved documents are refused, and those of a moving
 * model reach them, as they should.
 */
export function documentMovesText(moves: readonly DocumentMove[]): string {
  return [
    ...moves.map((move) => moveText(move, moves.length > 1)),
    applyText(moves.reduce((count, move) => count + move.copies.length, 0)),
    MOVE_LIMITS,
    stopText(moves),
  ].join('\n\n');
}
