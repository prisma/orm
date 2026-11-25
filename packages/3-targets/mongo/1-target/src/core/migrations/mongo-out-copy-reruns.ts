import { canonicalize } from '@internal/mongo-contract';
import {
  type AnyMongoMigrationOperation,
  DropCollectionCommand,
  isMongoDmlOperation,
} from '@internal/mongo-query-ast/control';
import { RawAggregateCommand, RawDeleteManyCommand } from '@internal/mongo-query-ast/execution';

/**
 * A copy the planner prints for a move into a time-series collection: a data transform whose run
 * reads its target, adds documents of one source with `$unionWith`, and writes them all back with
 * `$out`. `filter` is the `$match` of its one `$unionWith` pipeline; a copy of every document of the
 * source, as the rename route prints, has none.
 */
interface UnionCopy {
  readonly id: string;
  readonly into: string;
  readonly source: string;
  readonly filter: string | undefined;
}

interface Union {
  readonly coll: string;
  readonly filter: string | undefined;
  readonly whole: boolean;
}

function unionOf(stage: unknown): Union | undefined {
  if (typeof stage !== 'object' || stage === null) return undefined;
  const union: unknown = Reflect.get(stage, '$unionWith');
  if (typeof union === 'string') return { coll: union, filter: undefined, whole: true };
  if (typeof union !== 'object' || union === null) return undefined;
  const coll: unknown = Reflect.get(union, 'coll');
  if (typeof coll !== 'string') return undefined;
  const pipeline: unknown = Reflect.get(union, 'pipeline');
  if (pipeline === undefined) return { coll, filter: undefined, whole: true };
  if (!Array.isArray(pipeline)) return undefined;
  const [first]: unknown[] = pipeline;
  if (first === undefined) return { coll, filter: undefined, whole: true };
  const match: unknown =
    typeof first === 'object' && first !== null ? Reflect.get(first, '$match') : undefined;
  return { coll, filter: match === undefined ? undefined : canonicalize(match), whole: false };
}

function outOf(stage: unknown): string | undefined {
  if (typeof stage !== 'object' || stage === null) return undefined;
  const out: unknown = Reflect.get(stage, '$out');
  if (typeof out === 'string') return out;
  if (typeof out !== 'object' || out === null) return undefined;
  const coll: unknown = Reflect.get(out, 'coll');
  return typeof coll === 'string' && Reflect.get(out, 'db') === undefined ? coll : undefined;
}

function unionCopyOf(operation: AnyMongoMigrationOperation): UnionCopy | undefined {
  if (!isMongoDmlOperation(operation) || operation.operationClass !== 'data') return undefined;
  const [plan, ...more] = operation.run;
  const command = plan?.command;
  if (more.length > 0 || !(command instanceof RawAggregateCommand)) return undefined;
  const [stage, out, ...rest] = command.pipeline;
  const union = unionOf(stage);
  const into = outOf(out);
  if (union === undefined || into !== command.collection || rest.length > 0) return undefined;
  if (union.coll === into || (!union.whole && union.filter === undefined)) return undefined;
  return { id: operation.id, into, source: union.coll, filter: union.filter };
}

/** Whether `operation` is the step that removes the copied documents from the copy's source: a delete with the copy's filter, or, for a copy of the whole source, its drop. */
function removesCopied(operation: AnyMongoMigrationOperation, copy: UnionCopy): boolean {
  if (copy.filter === undefined) {
    return (
      !isMongoDmlOperation(operation) &&
      operation.execute.some(
        ({ command }) =>
          command instanceof DropCollectionCommand && command.collection === copy.source,
      )
    );
  }
  if (!isMongoDmlOperation(operation)) return false;
  const [plan, ...more] = operation.run;
  const command = plan?.command;
  return (
    more.length === 0 &&
    command instanceof RawDeleteManyCommand &&
    command.collection === copy.source &&
    canonicalize(command.filter) === copy.filter
  );
}

function unfinishedDeleteText(copy: UnionCopy, deleteId: string): string {
  const { id, into, source } = copy;
  return `Operation ${id} copied documents into collection ${into} with an $out stage, and operation ${deleteId}, which deletes them from collection ${source}, has not finished. Before you run the command again, finish that delete yourself, on collection ${source} with the filter of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection ${source} to collection ${into} a second time. Do not delete documents from collection ${into} instead. If the command was already run again before the delete finished, the moved documents are in collection ${into} more than once: the copy's filter, run on collection ${into}, selects each of them two or more times, under the same _id.`;
}

function undroppedText(copy: UnionCopy, dropId: string): string {
  const { id, into, source } = copy;
  return `Operation ${id} copied the documents of collection ${source} into collection ${into} with an $out stage, and operation ${dropId}, which drops collection ${source}, has not run. Before you run the command again, delete the documents of collection ${source} or drop it yourself: the copy has no check, so it runs again, and it would add the documents of collection ${source} to collection ${into} a second time. Do not delete documents from collection ${into} instead. If the command was already run again before collection ${source} was dropped, its documents are in collection ${into} more than once: each of them is there two or more times, under the same _id.`;
}

/**
 * What to do before a re-run about a copy the planner prints for a move into a time-series
 * collection, when the apply stopped after it and before the delete or the drop that follows it.
 * The copy has no check, so a re-run adds the documents still in its source a second time. Any
 * other copy gets no text: the runner cannot tell what its re-run does.
 */
export function outCopyRerunText(
  operations: readonly AnyMongoMigrationOperation[],
  stoppedAt: number,
): string | undefined {
  const texts = operations.slice(0, stoppedAt).flatMap((operation, index) => {
    const copy = unionCopyOf(operation);
    if (copy === undefined) return [];
    const removalIndex = operations.findIndex(
      (later, laterIndex) => laterIndex > index && removesCopied(later, copy),
    );
    const removal = operations[removalIndex];
    if (removal === undefined || removalIndex < stoppedAt) return [];
    return [
      copy.filter === undefined
        ? undroppedText(copy, removal.id)
        : unfinishedDeleteText(copy, removal.id),
    ];
  });
  return texts.length === 0 ? undefined : texts.join(' ');
}
