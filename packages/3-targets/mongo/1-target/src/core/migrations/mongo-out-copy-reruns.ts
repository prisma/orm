import {
  type AnyMongoMigrationOperation,
  isMongoDmlOperation,
} from '@internal/mongo-query-ast/control';
import { RawAggregateCommand, RawDeleteManyCommand } from '@internal/mongo-query-ast/execution';

/** A data transform whose run is a raw aggregate ending in `$out`, and the collections it reads besides the one it writes. */
interface OutCopy {
  readonly id: string;
  readonly into: string;
  readonly readsTarget: boolean;
  readonly sources: readonly string[];
}

function collectionNamed(value: unknown): string | undefined {
  if (typeof value === 'string') return value;
  if (typeof value !== 'object' || value === null) return undefined;
  const coll: unknown = Reflect.get(value, 'coll');
  return typeof coll === 'string' ? coll : undefined;
}

function outCopyOf(operation: AnyMongoMigrationOperation): OutCopy | undefined {
  if (!isMongoDmlOperation(operation) || operation.operationClass !== 'data') return undefined;
  const [plan] = operation.run;
  const command = plan?.command;
  if (operation.run.length !== 1 || !(command instanceof RawAggregateCommand)) return undefined;
  const last = command.pipeline.at(-1);
  const into = last === undefined ? undefined : collectionNamed(Reflect.get(last, '$out'));
  if (into === undefined) return undefined;
  const unions = command.pipeline.flatMap((stage) => {
    const coll = collectionNamed(Reflect.get(stage, '$unionWith'));
    return coll === undefined ? [] : [coll];
  });
  const sources = [...new Set([command.collection, ...unions])].filter((name) => name !== into);
  return { id: operation.id, into, readsTarget: command.collection === into, sources };
}

function deletedCollectionOf(operation: AnyMongoMigrationOperation): string | undefined {
  if (!isMongoDmlOperation(operation)) return undefined;
  const command = operation.run.find(
    (plan) => plan.command instanceof RawDeleteManyCommand,
  )?.command;
  return command instanceof RawDeleteManyCommand ? command.collection : undefined;
}

function unfinishedDeleteText(copy: OutCopy, deleteId: string, source: string): string {
  return `Operation ${copy.id} copied documents into collection ${copy.into} with an $out stage, and operation ${deleteId}, which deletes them from collection ${source}, has not finished. Before you run the command again, finish that delete yourself, on collection ${source} with the filter of its deleteDocuments call in the migration's migration.ts: the copy has no check, so it runs again, and it would add the documents still in collection ${source} to collection ${copy.into} a second time. Do not delete documents from collection ${copy.into} instead.`;
}

function unpairedText(copy: OutCopy): string {
  const sources = copy.sources.map((name) => `collection ${name}`).join(' and ');
  return `Operation ${copy.id} copied documents into collection ${copy.into} with an $out stage, and it has no check, so it runs again. If the documents it copied are still in ${sources} and are meant to leave it, delete them there before you run the command again: otherwise the copy adds them to collection ${copy.into} a second time.`;
}

function emptiedText(copy: OutCopy, deleteId: string, source: string): string {
  return `Operation ${copy.id} copied documents from collection ${source} into collection ${copy.into} with an $out stage, which replaces everything collection ${copy.into} holds, and operation ${deleteId} has since deleted them from collection ${source}. The copy has no check, so it runs again, and it would then empty collection ${copy.into}. Before you run the command again, change the copy in the migration's migration.ts to read collection ${copy.into} and add the documents of collection ${source} with a $unionWith stage, as rawAggregate(${JSON.stringify(copy.into)}, [{ $unionWith: { coll: ${JSON.stringify(source)}, pipeline: [<its stages before the $out>] } }, { $out: ${JSON.stringify(copy.into)} }]) does, and run the file with node.`;
}

/**
 * What to do before a re-run about each `$out` copy that ran before the stop, since a copy has no
 * check and runs again. A copy that reads its target with `$unionWith` writes the moved documents
 * twice when the delete that follows it has not finished; a copy that reads only its source empties
 * its target once that delete has finished.
 */
export function outCopyRerunText(
  operations: readonly AnyMongoMigrationOperation[],
  stoppedAt: number,
): string | undefined {
  const texts = operations.slice(0, stoppedAt).flatMap((operation, index) => {
    const copy = outCopyOf(operation);
    if (copy === undefined) return [];
    const deleteIndex = operations.findIndex((later, laterIndex) => {
      const deleted = laterIndex > index ? deletedCollectionOf(later) : undefined;
      return deleted !== undefined && copy.sources.includes(deleted);
    });
    const deletion = operations[deleteIndex];
    const source = deletion === undefined ? undefined : deletedCollectionOf(deletion);
    if (deletion === undefined || source === undefined) {
      return copy.readsTarget ? [unpairedText(copy)] : [];
    }
    const finished = deleteIndex < stoppedAt;
    if (copy.readsTarget) {
      return finished ? [] : [unfinishedDeleteText(copy, deletion.id, source)];
    }
    return finished ? [emptiedText(copy, deletion.id, source)] : [];
  });
  return texts.length === 0 ? undefined : texts.join(' ');
}
