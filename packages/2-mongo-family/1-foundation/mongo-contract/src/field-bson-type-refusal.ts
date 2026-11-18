import type { TypeLookups } from '@internal/framework-components/codec';
import { bsonTypesOfCodec } from './mongo-data-type';

/**
 * Why the contract cannot describe a field of codec `codecId`: its BSON type is unknown. `unknownCodec`: no pack in the contract provides the codec. `notMongoDataType`: the codec's data type is not a MongoDB data type, so it names no BSON type.
 */
export type FieldBsonTypeRefusal =
  | { readonly kind: 'unknownCodec'; readonly reason: string }
  | { readonly kind: 'notMongoDataType'; readonly reason: string; readonly dataType: string };

const CANNOT_GIVE = 'so its BSON type is unknown and the contract cannot describe the field.';

/**
 * Why a field of codec `codecId` cannot be described, or undefined when its BSON type is known. The reason leaves out its subject so each authoring surface can lead with its own, as in `Field "Place.location" uses codec ...`.
 */
export function fieldBsonTypeRefusalOf(
  codecId: string,
  lookups: TypeLookups,
): FieldBsonTypeRefusal | undefined {
  if (bsonTypesOfCodec(codecId, lookups) !== undefined) return undefined;
  const descriptor = lookups.codecLookup.descriptorFor(codecId);
  if (descriptor === undefined) {
    return {
      kind: 'unknownCodec',
      reason: `uses codec "${codecId}", which no pack in the contract provides, ${CANNOT_GIVE}`,
    };
  }
  return {
    kind: 'notMongoDataType',
    dataType: descriptor.dataType,
    reason: `uses codec "${codecId}", whose data type "${descriptor.dataType}" is not a MongoDB data type of any pack in the contract, ${CANNOT_GIVE}`,
  };
}
