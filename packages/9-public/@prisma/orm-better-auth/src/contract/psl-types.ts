import type { DBFieldAttribute } from '@better-auth/core/db';
import {
  type BetterAuthReference,
  type IdStrategy,
  isIdReference,
} from '../models/better-auth-models';
import type { ContractComparison } from './compare';

export type PslTypeContext = Pick<ContractComparison, 'idStrategy' | 'uuidKeyedModels'>;

/** How a Better Auth field is written in PSL, without `?`. A foreign key to a model whose `id` is a `Uuid` is a `Uuid`, since PostgreSQL refuses a `text` key that references a `uuid`. */
export function pslTypeOf(
  attribute: DBFieldAttribute,
  reference: BetterAuthReference | undefined,
  { idStrategy, uuidKeyedModels }: PslTypeContext,
): string {
  if (isIdReference(attribute)) {
    if (reference !== undefined && uuidKeyedModels.has(reference.model)) return 'Uuid';
    return idStrategy === 'serial' ? 'Int' : 'String';
  }
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
