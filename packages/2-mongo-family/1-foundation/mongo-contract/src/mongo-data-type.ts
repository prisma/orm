/**
 * Mongo data types: a data type with the BSON types a value of it is stored as. A type stored as
 * more than one BSON type lists each, and a type that accepts any BSON value lists none.
 *
 * ADR 254.
 */

import type {
  CodecLookupWithDescriptors,
  DataType,
  DataTypeLookup,
  DataTypeSpec,
} from '@internal/framework-components/codec';
import { dataType } from '@internal/framework-components/codec';

export interface MongoDataTypeSpec extends DataTypeSpec {
  readonly bsonTypes: readonly string[];
}

export interface MongoDataTypeFacts {
  readonly bsonTypes: readonly string[];
}

export interface MongoDataType extends DataType {
  readonly mongo: MongoDataTypeFacts;
}

export function mongoDataType(id: string, spec: MongoDataTypeSpec): MongoDataType {
  const { bsonTypes, ...frameworkSpec } = spec;
  return { ...dataType(id, frameworkSpec), mongo: { bsonTypes: [...bsonTypes] } };
}

export function isMongoDataType(type: DataType): type is MongoDataType {
  return 'mongo' in type;
}

/** The lookups that find the Mongo data type a codec represents. */
export interface MongoTypeLookups {
  readonly codecLookup: Pick<CodecLookupWithDescriptors, 'descriptorFor'>;
  readonly dataTypeLookup: Pick<DataTypeLookup, 'get'>;
}

/**
 * The BSON types a value of the codec `codecId` is stored as, read from the data type the codec
 * represents; undefined when the stack registers no such codec or Mongo data type.
 */
export function bsonTypesOfCodec(
  codecId: string,
  lookups: MongoTypeLookups,
): readonly string[] | undefined {
  const descriptor = lookups.codecLookup.descriptorFor(codecId);
  const type =
    descriptor === undefined ? undefined : lookups.dataTypeLookup.get(descriptor.dataType);
  return type !== undefined && isMongoDataType(type) ? type.mongo.bsonTypes : undefined;
}
