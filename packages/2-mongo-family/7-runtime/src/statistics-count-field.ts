/** The result field that holds a command's statement statistics, or `undefined` for a command that reports none. */
export function statisticsCountField(
  commandKind: string,
): 'modifiedCount' | 'deletedCount' | undefined {
  switch (commandKind) {
    case 'updateOne':
    case 'updateMany':
      return 'modifiedCount';
    case 'deleteOne':
    case 'deleteMany':
      return 'deletedCount';
    default:
      return undefined;
  }
}
