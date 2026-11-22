import type { DBFieldAttribute } from '@better-auth/core/db';
import { type IdStrategy, isIdReference } from '../models/better-auth-models';

/** How a Better Auth field is written in PSL, without `?`. */
export function pslTypeOf(attribute: DBFieldAttribute, idStrategy: IdStrategy): string {
  if (isIdReference(attribute)) return idStrategy === 'serial' ? 'Int' : 'String';
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

export interface IdField {
  readonly name: 'id';
  readonly type: string;
  readonly attributes: string;
}

/** The `id` field the printed PSL declares, as its columns. */
export function idFieldOf(idStrategy: IdStrategy): IdField {
  switch (idStrategy) {
    case 'serial':
      return { name: 'id', type: 'Int', attributes: '@id @default(autoincrement())' };
    case 'contract':
      return { name: 'id', type: 'String', attributes: '@id @onCreate(uuid())' };
    default:
      return { name: 'id', type: 'String', attributes: '@id' };
  }
}

export function idLineOf(idStrategy: IdStrategy): string {
  const { name, type, attributes } = idFieldOf(idStrategy);
  return `${name} ${type} ${attributes}`;
}
