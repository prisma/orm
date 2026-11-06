import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import type { AnyMongoDmlWireCommand } from '@internal/mongo-wire';

/**
 * The result field that holds a command's statement statistics, or `undefined` for a command that reports none. Prepare reads a draft's kind and ad-hoc `execute` reads a wire command's kind; a raw update or delete draft is an update or delete wire command, so both agree.
 */
export function statisticsCountField(
  commandKind: MongoLoweredDraft['kind'] | AnyMongoDmlWireCommand['kind'],
): 'modifiedCount' | 'deletedCount' | undefined {
  switch (commandKind) {
    case 'updateOne':
    case 'updateMany':
    case 'rawUpdateOne':
    case 'rawUpdateMany':
      return 'modifiedCount';
    case 'deleteOne':
    case 'deleteMany':
    case 'rawDeleteOne':
    case 'rawDeleteMany':
      return 'deletedCount';
    default:
      return undefined;
  }
}
