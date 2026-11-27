import { canonicalize } from '@internal/mongo-contract';
import {
  type AnyMongoMigrationOperation,
  DropCollectionCommand,
  isMongoDmlOperation,
} from '@internal/mongo-query-ast/control';
import { RawAggregateCommand, RawDeleteManyCommand } from '@internal/mongo-query-ast/execution';
import {
  type ApplyProgress,
  type CopyCounts,
  operationsThatMayHaveRun,
} from './mongo-apply-progress';
import { joinedList } from './mongo-plan-text';

/**
 * A copy the planner prints for a move into a time-series collection: a data transform whose run
 * reads its target, adds documents of one source with `$unionWith` stages, and writes them all back
 * with `$out`. `filters` holds the `$match` of each `$unionWith` pipeline, one for each group of
 * models; it is empty for a copy of every document of the source, as the rename route prints.
 * `pipelines` holds each `$unionWith` pipeline whole, in the same order, or one empty pipeline for
 * a copy of every document.
 */
export interface UnionCopy {
  readonly id: string;
  readonly into: string;
  readonly source: string;
  readonly filters: readonly Record<string, unknown>[];
  readonly pipelines: readonly (readonly unknown[])[];
}

interface Union {
  readonly coll: string;
  readonly filter: Record<string, unknown> | undefined;
  readonly whole: boolean;
  readonly pipeline: readonly unknown[];
}

function unionOf(stage: unknown): Union | undefined {
  if (typeof stage !== 'object' || stage === null) return undefined;
  const union: unknown = Reflect.get(stage, '$unionWith');
  if (typeof union === 'string')
    return { coll: union, filter: undefined, whole: true, pipeline: [] };
  if (typeof union !== 'object' || union === null) return undefined;
  const coll: unknown = Reflect.get(union, 'coll');
  if (typeof coll !== 'string') return undefined;
  const pipeline: unknown = Reflect.get(union, 'pipeline');
  if (pipeline === undefined) return { coll, filter: undefined, whole: true, pipeline: [] };
  if (!Array.isArray(pipeline)) return undefined;
  const [first]: unknown[] = pipeline;
  if (first === undefined) return { coll, filter: undefined, whole: true, pipeline: [] };
  const match: unknown =
    typeof first === 'object' && first !== null ? Reflect.get(first, '$match') : undefined;
  return {
    coll,
    filter: typeof match === 'object' && match !== null ? { ...match } : undefined,
    whole: false,
    pipeline,
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
    return unions.length === 1
      ? { id: operation.id, into, source, filters: [], pipelines: [[]] }
      : undefined;
  }
  const groups = unions.flatMap((union) =>
    union?.coll === source && !union.whole && union.filter !== undefined
      ? [{ filter: union.filter, pipeline: union.pipeline }]
      : [],
  );
  if (groups.length !== unions.length) return undefined;
  return {
    id: operation.id,
    into,
    source,
    filters: groups.map(({ filter }) => filter),
    pipelines: groups.map(({ pipeline }) => pipeline),
  };
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

/**
 * The mongosh query that lists the documents of `copy`'s source that one of its groups copied:
 * those whose result through the group's `$unionWith` pipeline the target holds whole, under the
 * same `_id`. The comparison ignores the order of top-level fields.
 */
function copiedQuery(copy: UnionCopy, pipeline: readonly unknown[]): string {
  const sameDocument = {
    $setEquals: [{ $objectToArray: '$$ROOT' }, { $objectToArray: '$$copied' }],
  };
  const stages = [
    ...pipeline,
    {
      $lookup: {
        from: copy.into,
        localField: '_id',
        foreignField: '_id',
        let: { copied: '$$ROOT' },
        pipeline: [{ $match: { $expr: sameDocument } }],
        as: 'inTarget',
      },
    },
    { $match: { inTarget: { $ne: [] } } },
    { $project: { _id: 1 } },
  ];
  return `db.getCollection(${JSON.stringify(copy.source)}).aggregate(${JSON.stringify(stages)})`;
}

/** How to find the documents of `copy`'s source that it copied, so that only those are deleted by hand. */
function comparisonText(copy: UnionCopy): string {
  const { into, source } = copy;
  const groups = copy.filters.length;
  const queries = joinedList(copy.pipelines.map((pipeline) => copiedQuery(copy, pipeline)));
  const rule =
    groups === 0
      ? `a document of collection ${source} was copied when collection ${into} holds the same document, whole and under the same _id. List those with ${queries} in mongosh.`
      : `a document of collection ${source} that ${groups === 1 ? "the copy's $match filter selects" : "one of the copy's $match filters selects"} was copied when collection ${into} holds, whole and under the same _id, the document the copy's stages make of it. List those with ${queries}${groups === 1 ? '' : ', one query for each $unionWith stage of the copy,'} in mongosh.`;
  return `compare the two collections: ${rule} Delete only the listed documents from collection ${source} yourself, by their _id, then run the command again. A document that is not listed was not copied, or changed after the copy: the run copies it, and if collection ${into} already holds its earlier form under the same _id, it then holds both, so delete the earlier one there yourself. A document whose copied form is identical to one collection ${into} already held is listed as copied: its content is there under the same _id, so deleting it loses only a second identical copy. If you must keep such identical documents, keep collection ${source} as it is and reconcile the two collections by hand.`;
}

/** Why writes to both collections of `copy` must still be stopped before its source is emptied by hand, and what to do when that cannot be known. */
function writesStoppedText(copy: UnionCopy, single: boolean): string {
  const { into, source } = copy;
  const removal =
    copy.filters.length === 0
      ? `deleting the documents of collection ${source} or dropping it also removes`
      : single
        ? 'that delete also removes'
        : 'those deletes also remove';
  return `Writes to collections ${into} and ${source} must still be stopped: ${removal} any document written to collection ${source} since the copy, which the copy did not take. If you cannot be sure that nothing wrote to either collection since the apply stopped, keep collection ${source} as it is and ${comparisonText(copy)} Otherwise`;
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
  return `Operation ${id} copied documents into collection ${into} with an $out stage, and ${deletes}. ${writesStoppedText(copy, one)}, before you run the command again, ${finish}: the copy has no check, so it runs again, and it would add the documents still in collection ${source} to collection ${into} a second time. Do not delete documents from collection ${into} instead. If the command was already run again before the ${one ? 'delete' : 'deletes'} finished, collection ${into} holds some of the moved documents two or more times, under the same _id. ${duplicatesText(into)}`;
}

/** `running` when the drop was running when the apply stopped, so it may or may not have dropped the source. */
function undroppedText(copy: UnionCopy, dropId: string, running: boolean): string {
  const { id, into, source } = copy;
  const drop = running
    ? `was running when the apply stopped and may not have finished. If collection ${source} is gone, run the command again. ${writesStoppedText(copy, true)}, before you run the command again, delete the documents of collection ${source} or drop it yourself`
    : `has not run. ${writesStoppedText(copy, true)}, before you run the command again, delete the documents of collection ${source} or drop it yourself`;
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
  return `${stopped} The error does not show whether the copy finished. ${removals}. Before the copy, collection ${into} held ${documentsText(counts.target)}, and the copy was to add ${documentsText(counts.selected)} of collection ${source}. To tell whether it finished, count the documents of collection ${into}, for example with db.getCollection(${JSON.stringify(into)}).countDocuments() in mongosh. If it holds ${counts.target + counts.selected}, the copy finished. ${writesStoppedText(copy, one)}, before you run the command again, ${finish}. The copy has no check, so it runs again, and it would add ${whole ? 'the documents of' : 'the documents still in'} collection ${source} to collection ${into} a second time. Do not delete documents from collection ${into} instead. If it holds ${counts.target}, the copy did not finish: delete nothing, and run the command again as it is. If it holds any other number, something else wrote to or deleted from collection ${into}, or the command was already run again. Delete nothing from collection ${source} until you ${comparisonText(copy)} If the command was already run again after the copy finished, collection ${into} holds some of the moved documents two or more times, under the same _id. ${duplicatesText(into)}`;
}

/**
 * What to do before a re-run about a copy the planner prints for a move into a time-series
 * collection, when the apply stopped after it, or while it ran, and before the delete or the drop
 * that follows it finished. The copy has no check, so a re-run adds the documents still in its
 * source a second time. A copy that was running when the apply stopped had its counts read before
 * it started. Any other copy gets no text: the
 * runner cannot tell what its re-run does.
 */
export function outCopyRerunText(progress: Readonly<ApplyProgress>): string | undefined {
  const { operations, finished, inFlight, copyCounts } = progress;
  const texts = operationsThatMayHaveRun(progress).flatMap((operation, index) => {
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
