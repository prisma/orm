import { canonicalize } from '@internal/mongo-contract';
import {
  type AnyMongoMigrationOperation,
  DropCollectionCommand,
  isMongoDmlOperation,
} from '@internal/mongo-query-ast/control';
import { RawAggregateCommand, RawDeleteManyCommand } from '@internal/mongo-query-ast/execution';
import type { ApplyProgress, CopyCounts } from './mongo-apply-progress';
import { joinedList } from './mongo-plan-text';

/**
 * A copy the planner prints for a move into a time-series collection: a data transform whose run
 * reads its target, adds documents of one source with `$unionWith` stages, and writes them all back
 * with `$out`. `filters` holds the `$match` of each `$unionWith` pipeline, one for each group of
 * models; it is empty for a copy of every document of the source, as the rename route prints.
 */
export interface UnionCopy {
  readonly id: string;
  readonly into: string;
  readonly source: string;
  readonly filters: readonly Record<string, unknown>[];
}

interface Union {
  readonly coll: string;
  readonly filter: Record<string, unknown> | undefined;
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
  return {
    coll,
    filter: typeof match === 'object' && match !== null ? { ...match } : undefined,
    whole: false,
  };
}

function outOf(stage: unknown): string | undefined {
  if (typeof stage !== 'object' || stage === null) return undefined;
  const out: unknown = Reflect.get(stage, '$out');
  if (typeof out === 'string') return out;
  if (typeof out !== 'object' || out === null) return undefined;
  const coll: unknown = Reflect.get(out, 'coll');
  return typeof coll === 'string' && Reflect.get(out, 'db') === undefined ? coll : undefined;
}

/** The copy `operation` is, when it is one the planner prints for a move into a time-series collection. */
export function unionCopyOf(operation: AnyMongoMigrationOperation): UnionCopy | undefined {
  if (!isMongoDmlOperation(operation) || operation.operationClass !== 'data') return undefined;
  const [plan, ...more] = operation.run;
  const command = plan?.command;
  if (more.length > 0 || !(command instanceof RawAggregateCommand)) return undefined;
  const stages = command.pipeline;
  const into = outOf(stages.at(-1));
  const unions = stages.slice(0, -1).map(unionOf);
  const [first] = unions;
  if (first === undefined || into !== command.collection) return undefined;
  const source = first.coll;
  if (source === into) return undefined;
  if (first.whole) {
    return unions.length === 1 ? { id: operation.id, into, source, filters: [] } : undefined;
  }
  const filters = unions.map((union) =>
    union?.coll === source && !union.whole ? union.filter : undefined,
  );
  if (!filters.every((filter) => filter !== undefined)) return undefined;
  return { id: operation.id, into, source, filters };
}

function dropsSource(operation: AnyMongoMigrationOperation, copy: UnionCopy): boolean {
  return (
    !isMongoDmlOperation(operation) &&
    operation.execute.some(
      ({ command }) =>
        command instanceof DropCollectionCommand && command.collection === copy.source,
    )
  );
}

function deletesFromSource(
  operation: AnyMongoMigrationOperation,
  copy: UnionCopy,
  filter: Record<string, unknown>,
): boolean {
  if (!isMongoDmlOperation(operation)) return false;
  const [plan, ...more] = operation.run;
  const command = plan?.command;
  return (
    more.length === 0 &&
    command instanceof RawDeleteManyCommand &&
    command.collection === copy.source &&
    canonicalize(command.filter) === canonicalize(filter)
  );
}

/**
 * The index of each step after the copy at `index` that removes what the copy took from its
 * source: the delete with the filter of each `$unionWith` stage, or, for a copy of the whole
 * source, its drop. `undefined` when one of them is missing.
 */
function removalsOf(
  operations: readonly AnyMongoMigrationOperation[],
  index: number,
  copy: UnionCopy,
): readonly number[] | undefined {
  const removes =
    copy.filters.length === 0
      ? [(operation: AnyMongoMigrationOperation) => dropsSource(operation, copy)]
      : copy.filters.map(
          (filter) => (operation: AnyMongoMigrationOperation) =>
            deletesFromSource(operation, copy, filter),
        );
  const found = removes.map((removes) =>
    operations.findIndex((later, laterIndex) => laterIndex > index && removes(later)),
  );
  return found.every((removal) => removal !== -1) ? found : undefined;
}

function duplicatesText(into: string): string {
  return `To find them, group collection ${into} by _id and keep each _id that appears more than once, for example with db.getCollection(${JSON.stringify(into)}).aggregate([{ $group: { _id: '$_id', n: { $sum: 1 } } }, { $match: { n: { $gt: 1 } } }]) in mongosh.`;
}

function documentsText(count: number): string {
  return count === 1 ? '1 document' : `${count} documents`;
}

function unfinishedDeleteText(copy: UnionCopy, deleteIds: readonly string[]): string {
  const { id, into, source } = copy;
  const one = deleteIds.length === 1;
  const deletes = one
    ? `operation ${deleteIds[0]}, which deletes them from collection ${source}, has not finished`
    : `operations ${joinedList(deleteIds)}, which delete them from collection ${source}, have not finished`;
  const finish = one
    ? `finish that delete yourself, on collection ${source} with the filter of its deleteDocuments call in the migration's migration.ts`
    : `finish those deletes yourself, on collection ${source}, each with the filter of its deleteDocuments call in the migration's migration.ts`;
  return `Operation ${id} copied documents into collection ${into} with an $out stage, and ${deletes}. Before you run the command again, ${finish}: the copy has no check, so it runs again, and it would add the documents still in collection ${source} to collection ${into} a second time. Do not delete documents from collection ${into} instead. If the command was already run again before the ${one ? 'delete' : 'deletes'} finished, collection ${into} holds some of the moved documents two or more times, under the same _id. ${duplicatesText(into)}`;
}

/** `running` when the drop was running when the apply stopped, so it may or may not have dropped the source. */
function undroppedText(copy: UnionCopy, dropId: string, running: boolean): string {
  const { id, into, source } = copy;
  const drop = running
    ? `was running when the apply stopped and may not have finished. Before you run the command again, if collection ${source} still exists, delete its documents or drop it yourself`
    : `has not run. Before you run the command again, delete the documents of collection ${source} or drop it yourself`;
  return `Operation ${id} copied the documents of collection ${source} into collection ${into} with an $out stage, and operation ${dropId}, which drops collection ${source}, ${drop}: the copy has no check, so it runs again, and it would add the documents of collection ${source} to collection ${into} a second time. Do not delete documents from collection ${into} instead. If the command was already run again before collection ${source} was dropped, its documents are in collection ${into} more than once: each of them is there two or more times, under the same _id. ${duplicatesText(into)}`;
}

/**
 * The advice for a copy that was running when the apply stopped, from the counts read before it:
 * how to tell from the target's count whether it finished, and what to do in each case.
 */
function interruptedCopyText(
  copy: UnionCopy,
  removalIds: readonly string[],
  counts: CopyCounts,
): string {
  const { id, into, source } = copy;
  const whole = copy.filters.length === 0;
  const stopped = `Operation ${id} was copying ${whole ? 'the documents' : 'documents'} of collection ${source} into collection ${into} with an $out stage when the apply stopped.`;
  if (counts.selected === 0) {
    return `${stopped} Collection ${source} held no document for it to copy, so the command can run again as it is.`;
  }
  const one = removalIds.length === 1;
  const removals = whole
    ? `Operation ${removalIds[0]}, which drops collection ${source}, has not run`
    : one
      ? `Operation ${removalIds[0]}, which deletes them from collection ${source}, has not run`
      : `Operations ${joinedList(removalIds)}, which delete them from collection ${source}, have not run`;
  const finish = whole
    ? `delete the documents of collection ${source} or drop it yourself`
    : one
      ? `run that delete yourself, on collection ${source} with the filter of its deleteDocuments call in the migration's migration.ts`
      : `run those deletes yourself, on collection ${source}, each with the filter of its deleteDocuments call in the migration's migration.ts`;
  return `${stopped} The error does not show whether the copy finished. ${removals}. Before the copy, collection ${into} held ${documentsText(counts.target)}, and the copy was to add ${documentsText(counts.selected)} of collection ${source}. To tell whether it finished, count the documents of collection ${into}, for example with db.getCollection(${JSON.stringify(into)}).countDocuments() in mongosh. If it holds ${counts.target + counts.selected}, the copy finished: before you run the command again, ${finish}. The copy has no check, so it runs again, and it would add ${whole ? 'the documents of' : 'the documents still in'} collection ${source} to collection ${into} a second time. Do not delete documents from collection ${into} instead. If it holds ${counts.target}, the copy did not finish: delete nothing, and run the command again as it is. If it holds any other number, something else wrote to collection ${into} or collection ${source}, or the command was already run again: delete nothing until you have found out which. If the command was already run again after the copy finished, collection ${into} holds some of the moved documents two or more times, under the same _id. ${duplicatesText(into)}`;
}

/**
 * What to do before a re-run about a copy the planner prints for a move into a time-series
 * collection, when the apply stopped after it, or while it ran, and before the delete or the drop
 * that follows it finished. The copy has no check, so a re-run adds the documents still in its
 * source a second time. A copy that was running when the apply stopped gets text only when the
 * runner had read its counts: without them, it had not started. Any other copy gets no text: the
 * runner cannot tell what its re-run does.
 */
export function outCopyRerunText(progress: Readonly<ApplyProgress>): string | undefined {
  const { operations, finished, inFlight, copyCounts } = progress;
  const texts = operations.slice(0, finished + (inFlight ? 1 : 0)).flatMap((operation, index) => {
    const copy = unionCopyOf(operation);
    if (copy === undefined) return [];
    const pending = (removalsOf(operations, index, copy) ?? []).filter(
      (removalIndex) => removalIndex >= finished,
    );
    const ids = pending.flatMap((removalIndex) => operations[removalIndex]?.id ?? []);
    const [first] = ids;
    if (first === undefined) return [];
    if (index === finished) {
      return copyCounts === undefined ? [] : [interruptedCopyText(copy, ids, copyCounts)];
    }
    return [
      copy.filters.length === 0
        ? undroppedText(copy, first, inFlight && pending[0] === finished)
        : unfinishedDeleteText(copy, ids),
    ];
  });
  return texts.length === 0 ? undefined : texts.join(' ');
}
