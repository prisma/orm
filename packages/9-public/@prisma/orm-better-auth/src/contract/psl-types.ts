import type { DBFieldAttribute } from '@better-auth/core/db';
import {
  type BetterAuthReference,
  type IdStrategy,
  isIdReference,
} from '../models/better-auth-models';
import type { ContractComparison } from './compare';

export type PslTypeContext = Pick<ContractComparison, 'idStrategy' | 'uuidKeyedModels' | 'support'>;

/** How a Better Auth field is written in PSL, without `?`, as the target's support prints it. */
export function pslTypeOf(
  attribute: DBFieldAttribute,
  reference: BetterAuthReference | undefined,
  { idStrategy, uuidKeyedModels, support }: PslTypeContext,
): string {
  return support.pslType({
    attribute,
    idStrategy,
    isIdReference: isIdReference(attribute),
    referencesUuidId: reference !== undefined && uuidKeyedModels.has(reference.model),
  });
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
