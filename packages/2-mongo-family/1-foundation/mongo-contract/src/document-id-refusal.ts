import type { ContractField } from '@internal/contract/types';
import type { TypeLookups } from '@internal/framework-components/codec';
import { bsonTypesOfCodec } from './mongo-data-type';

/** The BSON types an `_id` cannot have: MongoDB refuses an array, a regular expression and undefined, and every document has an `_id`. */
const FORBIDDEN_DOCUMENT_ID_BSON_TYPES: ReadonlySet<string> = new Set([
  'array',
  'regex',
  'undefined',
  'null',
]);

export interface DocumentIdRefusal {
  /** The BSON types the `_id` can hold that an `_id` cannot have. */
  readonly forbidden: readonly string[];
  readonly reason: string;
}

/**
 * Why an `_id` stored by `codecId` cannot hold `forbidden`, the BSON types it can hold that an `_id` cannot have; an empty list means it can hold any BSON type. The subject is left out, so each caller leads with its own.
 */
export function documentIdRefusalReason(codecId: string, forbidden: readonly string[]): string {
  const held = forbidden.length === 0 ? 'any BSON type' : `BSON type ${forbidden.join(' or ')}`;
  return `can hold ${held} (codec "${codecId}"). An _id cannot be an array, a regular expression, undefined or null: MongoDB refuses the first three, and every document has an _id.`;
}

/**
 * The refusal of an `_id` that can hold `bsonTypes`, or undefined when an `_id` can. An empty list means any BSON type, which includes all of them.
 */
export function documentIdRefusalOf(
  codecId: string,
  bsonTypes: readonly string[],
): DocumentIdRefusal | undefined {
  if (bsonTypes.length === 0) {
    return {
      forbidden: [...FORBIDDEN_DOCUMENT_ID_BSON_TYPES],
      reason: documentIdRefusalReason(codecId, []),
    };
  }
  const forbidden = bsonTypes.filter((bsonType) => FORBIDDEN_DOCUMENT_ID_BSON_TYPES.has(bsonType));
  return forbidden.length === 0
    ? undefined
    : { forbidden, reason: documentIdRefusalReason(codecId, forbidden) };
}

/**
 * The BSON types a field stored as `_id` can hold: its codec's, an array for a list, and null for a nullable field. Undefined for a value object, which is stored as an object, and for a codec whose BSON types are unknown, which the field rule refuses.
 */
export function documentIdBsonTypesOf(
  field: ContractField,
  lookups: TypeLookups,
): readonly string[] | undefined {
  if (field.type.kind !== 'scalar') return undefined;
  const codecTypes = bsonTypesOfCodec(field.type.codecId, lookups);
  if (codecTypes === undefined) return undefined;
  const stored = field.many ? ['array'] : codecTypes;
  return field.nullable ? [...stored, 'null'] : stored;
}
