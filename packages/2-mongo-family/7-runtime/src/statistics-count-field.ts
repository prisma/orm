import type { MongoLoweredDraft } from '@internal/mongo-lowering';
import type { AnyMongoDmlWireCommand } from '@internal/mongo-wire';

/** The commands that report statement statistics, each with the result field that holds its count. */
export const statisticsCountFields = {
  updateOne: 'modifiedCount',
  updateMany: 'modifiedCount',
  rawUpdateOne: 'modifiedCount',
  rawUpdateMany: 'modifiedCount',
  deleteOne: 'deletedCount',
  deleteMany: 'deletedCount',
  rawDeleteOne: 'deletedCount',
  rawDeleteMany: 'deletedCount',
} as const;

function isStatisticsKind(kind: string): kind is keyof typeof statisticsCountFields {
  return Object.hasOwn(statisticsCountFields, kind);
}

/**
 * The result field that holds a command's statement statistics, or `undefined` for a command that reports none. Prepare reads a draft's kind and ad-hoc `execute` reads a wire command's kind; a raw update or delete draft is an update or delete wire command, so both agree.
 */
export function statisticsCountField(
  commandKind: MongoLoweredDraft['kind'] | AnyMongoDmlWireCommand['kind'],
): 'modifiedCount' | 'deletedCount' | undefined {
  return isStatisticsKind(commandKind) ? statisticsCountFields[commandKind] : undefined;
}
