import type { PslField } from '../target-support';

/** The PSL type of a Better Auth field on a database where a plain `String` holds text of any length. */
export function standardPslType({ attribute, idStrategy, isIdReference }: PslField): string {
  if (isIdReference) return idStrategy === 'serial' ? 'Int' : 'String';
  switch (attribute.type) {
    case 'number':
      return attribute.bigint === true ? 'BigInt(as: number)' : 'Int';
    case 'boolean':
      return 'Boolean';
    case 'date':
      return 'DateTime';
    default:
      return 'String';
  }
}
