/**
 * Mongo data types: a data type with the BSON types a value of it is stored as. A type stored as
 * more than one BSON type lists each, and a type that accepts any BSON value lists none.
 *
 * ADR 254.
 */

import type { JsonValue } from '@internal/contract/types';
import type {
  DataType,
  DataTypeParamsProblem,
  DataTypeSpec,
  TypeLookups,
} from '@internal/framework-components/codec';
import { dataType, dataTypeParamsProblem } from '@internal/framework-components/codec';
import { ifDefined } from '@internal/utils/defined';

/**
 * The value a migration writes into the existing documents that lack a new required field: the
 * update expression that stores it with the type's BSON type, and the value as messages show it.
 */
export interface MongoTemporaryValue {
  readonly expression: JsonValue;
  readonly text: string;
}

export interface MongoDataTypeSpec extends DataTypeSpec {
  readonly bsonTypes: readonly string[];
  readonly temporaryValue?: MongoTemporaryValue;
}

export interface MongoDataTypeFacts {
  readonly bsonTypes: readonly string[];
  readonly temporaryValue?: MongoTemporaryValue;
}

export interface MongoDataType extends DataType {
  readonly mongo: MongoDataTypeFacts;
}

export function mongoDataType(id: string, spec: MongoDataTypeSpec): MongoDataType {
  const { bsonTypes, temporaryValue, ...frameworkSpec } = spec;
  return {
    ...dataType(id, frameworkSpec),
    mongo: { bsonTypes: [...bsonTypes], ...ifDefined('temporaryValue', temporaryValue) },
  };
}

export function isMongoDataType(type: DataType): type is MongoDataType {
  return 'mongo' in type;
}

/**
 * The BSON types a value of the codec `codecId` is stored as, read from the data type the codec
 * represents; undefined when the stack registers no such codec or Mongo data type.
 */
export function bsonTypesOfCodec(
  codecId: string,
  lookups: TypeLookups,
): readonly string[] | undefined {
  const type = dataTypeOfCodec(codecId, lookups);
  return type !== undefined && isMongoDataType(type) ? type.mongo.bsonTypes : undefined;
}

/** The temporary value of the data type the codec `codecId` represents, when it has one. */
export function temporaryValueOfCodec(
  codecId: string,
  lookups: TypeLookups,
): MongoTemporaryValue | undefined {
  const type = dataTypeOfCodec(codecId, lookups);
  return type !== undefined && isMongoDataType(type) ? type.mongo.temporaryValue : undefined;
}

/** What is wrong with the type parameters `typeParams` for the data type the codec `codecId` represents, or undefined when it accepts them or the stack registers no such codec or data type. The Mongo contract builder checks each field with it: the type parameters a field carries reach only the TypeScript types and the emitted `contract.d.ts`, so nothing later checks them. */
export function codecTypeParamsProblem(
  codecId: string,
  typeParams: Readonly<Record<string, unknown>>,
  lookups: TypeLookups,
): DataTypeParamsProblem | undefined {
  const type = dataTypeOfCodec(codecId, lookups);
  return type === undefined ? undefined : dataTypeParamsProblem(type, typeParams);
}

function dataTypeOfCodec(codecId: string, lookups: TypeLookups): DataType | undefined {
  const descriptor = lookups.codecLookup.descriptorFor(codecId);
  return descriptor === undefined ? undefined : lookups.dataTypeLookup.get(descriptor.dataType);
}
