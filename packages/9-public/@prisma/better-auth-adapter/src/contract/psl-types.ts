import type { BetterAuthOptions } from '@better-auth/core';
import type { DBFieldAttribute } from '@better-auth/core/db';

/**
 * Who gives `id` its value. Better Auth sends a string (`string`) or a UUID string (`uuid`); or it sends none and the contract fills it, with an autoincrement number (`serial`) or with a database default or an `onCreate` generator (`contract`).
 */
export type IdStrategy = 'string' | 'uuid' | 'serial' | 'contract';

export function idStrategyOf(options: BetterAuthOptions): IdStrategy {
  const generateId = options.advanced?.database?.generateId;
  if (generateId === 'serial') return 'serial';
  if (generateId === 'uuid') return 'uuid';
  if (generateId === false) return 'contract';
  return 'string';
}

export function isIdReference(attribute: DBFieldAttribute): boolean {
  return attribute.references?.field === 'id';
}

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
