import {
  type FieldCoordinate,
  type ModelCoordinate,
  modelDisplayName,
} from '@internal/framework-components/control';
import { jsonToTsSource } from '@internal/ts-render';
import type { DocumentCopy, DocumentMove } from './mongo-document-moves';

/** Where a hand-written collection rename goes in a migration.ts: after the drops of indexes on `from`, which act on `from`, and before every other operation. */
export function byHandRenamePlacement(from: string, to: string): string {
  return `put renameCollection(${JSON.stringify(from)}, ${JSON.stringify(to)}) right after the drops of indexes on "${from}", if there are any, and before every other operation`;
}

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

/**
 * How a move's copy writes into its target. `$merge` cannot write into a time-series collection,
 * and `$out` replaces everything the collection holds, so a copy into one reads what the
 * collection holds, adds the moved documents with `$unionWith`, and writes them all back with
 * `$out`. A run after the delete then writes back what the collection already holds.
 */
type CopyWrite = 'merge' | 'unionOut';

function copyWriteOf(move: DocumentMove): CopyWrite {
  return move.timeSeries ? 'unionOut' : 'merge';
}

/** What a time-series collection allows a copy: the reason a move into it cannot end in `$merge`. */
export function timeSeriesCopyLimits(collection: string): string {
  return `Collection "${collection}" is a time-series collection, which a $merge stage cannot write into, and an $out stage replaces everything it holds.`;
}

/**
 * The copy of every document of collection `from` into the time-series collection `to` that
 * replaces it, as it goes in `migration.ts`, and what its re-run does: the plan drops `from` after
 * it, and once `from` is gone the copy adds nothing.
 */
export function timeSeriesRenameCopyText(from: string, to: string): string {
  const call = [
    `${CODE_INDENT}rawAggregate(${jsonToTsSource(to)}, [`,
    `${CODE_INDENT}${CODE_INDENT}${oneLine(jsonToTsSource({ $unionWith: from }))},`,
    `${CODE_INDENT}${CODE_INDENT}${oneLine(jsonToTsSource({ $out: to }))},`,
    `${CODE_INDENT}])`,
  ].join('\n');
  return `${timeSeriesCopyLimits(to)} So its run reads the documents collection "${to}" holds, adds those of collection "${from}" with a $unionWith stage, and writes them all back with an $out stage, which rewrites the whole collection:\n\n${call}\n\nThe copy has no check, so it runs again on every run of the migration; once collection "${from}" is dropped, it adds nothing. If the apply stops after the copy and before the drop, delete the documents of collection "${from}" or drop it yourself before you run db migrate again: otherwise the copy adds them to collection "${to}" a second time. Do not delete documents from collection "${to}" instead.`;
}

function rawAggregateCall(
  move: DocumentMove,
  collection: string,
  stages: readonly string[],
): string {
  const bypass = move.order.bypassDocumentValidation
    ? `, ${jsonToTsSource({ bypassDocumentValidation: true })}`
    : '';
  return [
    `${CODE_INDENT}rawAggregate(${jsonToTsSource(collection)}, [`,
    ...stages.map((stage) => `${CODE_INDENT}${CODE_INDENT}${stage},`),
    `${CODE_INDENT}]${bypass})`,
  ].join('\n');
}

function matchStage(selects: string): string {
  return `{ $match: <a filter that selects only ${selects}> }`;
}

/** A `rawAggregate` call of the move as it goes in `migration.ts`, one stage to a line. */
function copyCall(move: DocumentMove, copy: DocumentCopy, selects: string): string {
  return rawAggregateCall(move, move.from, [
    matchStage(selects),
    ...[...copy.fieldStages, { $merge: { into: move.to } }].map((stage) =>
      oneLine(jsonToTsSource(stage)),
    ),
  ]);
}

/** The one `rawAggregate` call of a move into a time-series collection: it reads that collection and adds each copy's documents with `$unionWith`. */
function unionCall(move: DocumentMove): string {
  const unions = move.copies.map(
    (copy) =>
      `{ $unionWith: { coll: ${jsonToTsSource(move.from)}, pipeline: [${[
        matchStage(
          move.copies.length === 1
            ? 'those documents'
            : `the documents of ${modelNamesText(copy.models)}`,
        ),
        ...copy.fieldStages.map((stage) => oneLine(jsonToTsSource(stage))),
      ].join(', ')}] } }`,
  );
  return rawAggregateCall(move, move.to, [...unions, oneLine(jsonToTsSource({ $out: move.to }))]);
}

/**
 * The deletes after the `$unionWith` copy of a move: one for each of its stages, with that stage's
 * filter, so that the runner can tell which of them has not finished when the apply stops.
 */
function unionDeletesText(
  move: DocumentMove,
  deletes: string,
  deleteCall: (filter: string) => string,
): string {
  const { from, to, copies } = move;
  const one = copies.length === 1;
  const calls = one
    ? deleteCall('<the same filter>')
    : copies
        .map((copy) =>
          deleteCall(`<the filter of the $unionWith stage of ${modelNamesText(copy.models)}>`),
        )
        .join('\n');
  const after = one
    ? `After it, add ${deletes}:`
    : `After it, add the operations that delete the documents of ${movingText(move)} from collection "${from}", one for each $unionWith stage, with that stage's filter:`;
  const stop = one
    ? `If the apply stops after the copy and before the delete has finished, finish that delete yourself, on collection "${from}" with the same filter,`
    : `If the apply stops after the copy and before the deletes have finished, finish them yourself, on collection "${from}", each with its stage's filter,`;
  return `${after}\n\n${calls}\n\nThe copy has no check, so it runs again on every run of the migration, and a run after the ${one ? 'delete has' : 'deletes have'} finished writes back what collection "${to}" already holds. ${stop} before you run db migrate again: otherwise the copy adds the documents still in collection "${from}" to collection "${to}" a second time. Do not delete documents from collection "${to}" instead: a time-series collection does not enforce a unique _id, so a delete by _id there can also remove a document it already held.`;
}

/**
 * The dataTransforms of a move, one for each copy, since a dataTransform's run is one query plan,
 * and after them the delete, which is an operation of its own.
 */
function copiesText(move: DocumentMove, write: CopyWrite): string {
  const { from, to, copies } = move;
  const [only] = copies;
  const deleteCall = (filter: string) =>
    `${CODE_INDENT}deleteDocuments({ collection: ${jsonToTsSource(from)}, filter: ${filter} })`;
  const deletes = `the operation that deletes the documents of ${movingText(move)} from collection "${from}"`;
  const sameFilter =
    copies.length === 1
      ? '<the same filter>'
      : '<a filter that selects the documents of all of them>';
  if (write === 'unionOut') {
    return `add a dataTransform. ${timeSeriesCopyLimits(to)} So its run reads the documents collection "${to}" holds, adds those of ${movingText(move)} with a $unionWith stage, and writes them all back with an $out stage, which rewrites the whole collection:\n\n${unionCall(move)}\n\n${unionDeletesText(move, deletes, deleteCall)}`;
  }
  return copies.length === 1 && only !== undefined
    ? `add a dataTransform. Its run copies the documents of ${movingText(move)} into collection "${to}":\n\n${copyCall(move, only, 'those documents')}\n\nAfter it, add ${deletes}:\n\n${deleteCall(sameFilter)}`
    : `add one dataTransform for each group of models whose documents change alike on the way into collection "${to}". The run of each is one of these copies:\n\n${copies.map((copy) => copyCall(move, copy, `the documents of ${modelNamesText(copy.models)}`)).join('\n\n')}\n\nAfter them, add ${deletes}:\n\n${deleteCall(sameFilter)}`;
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
  const one = move.copies.length === 1 && move.copies[0]?.models.length === 1;
  const none = one
    ? 'If it stores none, no field tells its documents apart'
    : 'If they store none, no field tells their documents apart';
  const byId = `${none}: select them by their _id values instead.`;
  return move.copies.length === 1
    ? `The filter must tell those documents apart from ${shared}. Filter by a field only ${movingText(move)} ${one ? 'stores' : 'store'}. ${byId}`
    : `Each copy's filter must select only the documents of its own models, apart from those of the other models that move and from ${shared}. Filter each copy by a field only its models store. ${byId}`;
}

function moveText(move: DocumentMove, naming: boolean, write: CopyWrite): string {
  const placement = naming
    ? `For ${movingText(move)}, ${placementClause(move)},`
    : `${capitalized(placementClause(move))},`;
  return `${placement} ${copiesText(move, write)}\n\n${filterText(move)}${droppedText(move)}${bypassText(move)}`;
}

function applyText(count: number): string {
  return count === 1
    ? 'Run that migration.ts to emit its ops.json, and apply it with db migrate.'
    : `${count === 2 ? 'Both' : `All ${count}`} dataTransforms go in that one migration.ts. Run it to emit its ops.json, and apply it once with db migrate.`;
}

/** What the user must hold while a hand-written move runs, since its copy and delete are two operations with no transaction, and `$merge` matches by `_id`. */
const MOVE_LIMITS =
  'Stop writes to each collection the documents move out of until the apply ends: the delete also removes a document of those models written there after the copy, and that document was not copied.';

const MERGE_LIMITS =
  ' $merge matches documents by _id, so a moved document whose _id a document of the collection it moves into already holds is merged into that document. Check first that no _id is in both collections, and stop writes to each collection the documents move into from before that check until the apply finishes, retries included: a document written there after the check could hold the _id of a document that moves.';

function outLimits(collections: readonly string[]): string {
  return collections.length === 0
    ? ''
    : ` Stop writes to ${namedList('collection', collections)} too, for the whole apply, retries included: an $out stage replaces the collection with what it read, so a document written there while the copy runs is lost. An $out stage cannot write into a sharded collection.`;
}

/** For each collection the documents of several collections move into, that their `_id` values must be checked against each other as well as against it. */
function sharedTargetText(moves: readonly DocumentMove[]): string {
  const sourcesOf = new Map<string, string[]>();
  for (const { from, to } of moves) {
    const sources = sourcesOf.get(to) ?? [];
    if (!sources.includes(from)) sources.push(from);
    sourcesOf.set(to, sources);
  }
  return [...sourcesOf]
    .filter(([, sources]) => sources.length > 1)
    .map(([to, sources]) => {
      const named = quotedList(sources);
      const each = sources.length === 2 ? 'both' : 'all';
      const other = sources.length === 2 ? 'the other' : 'another';
      return ` Collections ${named} ${each} move documents into collection "${to}", and a document moved from one is merged into a document with the same _id moved from ${other}: check that no _id is in two of collections ${quotedList([...sources, to])}.`;
    })
    .join('');
}

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
  const writes = moves.map((move) => ({ move, write: copyWriteOf(move) }));
  const merges = writes.filter(({ write }) => write === 'merge').map(({ move }) => move);
  const outs = [
    ...new Set(writes.filter(({ write }) => write !== 'merge').map(({ move }) => move.to)),
  ];
  return [
    ...writes.map(({ move, write }) => moveText(move, moves.length > 1, write)),
    applyText(
      writes.reduce(
        (count, { move, write }) => count + (write === 'unionOut' ? 1 : move.copies.length),
        0,
      ),
    ),
    `${MOVE_LIMITS}${merges.length === 0 ? '' : MERGE_LIMITS}${outLimits(outs)}${sharedTargetText(merges)}`,
    stopText(moves),
  ].join('\n\n');
}
