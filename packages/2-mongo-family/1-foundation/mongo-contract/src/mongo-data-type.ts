/**
 * Mongo data types: a data type with the BSON types a value of it is stored as. A type stored as
 * more than one BSON type lists each, and a type that accepts any BSON value lists none.
 *
 * ADR 254.
 */

import type { ContractField } from '@internal/contract/types';
import type {
  CodecLookupWithDescriptors,
  DataType,
  DataTypeLookup,
  DataTypeParamsProblem,
  DataTypeSpec,
} from '@internal/framework-components/codec';
import {
  assertDataTypeParams,
  dataType,
  dataTypeParamsProblem,
} from '@internal/framework-components/codec';

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
  const type = dataTypeOfCodec(codecId, lookups);
  return type !== undefined && isMongoDataType(type) ? type.mongo.bsonTypes : undefined;
}

type FieldOwner =
  | { readonly modelName: string; readonly valueObjectName?: never }
  | { readonly valueObjectName: string; readonly modelName?: never };

interface DomainNamespaceFields {
  readonly models: Readonly<
    Record<string, { readonly fields: Readonly<Record<string, ContractField>> }>
  >;
  readonly valueObjects?: Readonly<
    Record<string, { readonly fields: Readonly<Record<string, ContractField>> }>
  >;
}

/**
 * Refuses a field whose type parameters its codec's data type does not accept, such as a vector `length` of 0, with `CONTRACT.TYPE_PARAMS_INVALID`. A Mongo `defineContract` build calls it, and the PSL interpreter reports the same problem as a diagnostic through {@link codecTypeParamsProblem}: the type parameters a field carries reach only the TypeScript types and the emitted `contract.d.ts`, so nothing later checks them.
 */
export function assertMongoFieldTypeParams(
  namespaces: Readonly<Record<string, DomainNamespaceFields>>,
  lookups: MongoTypeLookups,
): void {
  for (const namespace of Object.values(namespaces)) {
    for (const [modelName, model] of Object.entries(namespace.models)) {
      assertFieldsTypeParams(model.fields, { modelName }, lookups);
    }
    for (const [valueObjectName, valueObject] of Object.entries(namespace.valueObjects ?? {})) {
      assertFieldsTypeParams(valueObject.fields, { valueObjectName }, lookups);
    }
  }
}

function assertFieldsTypeParams(
  fields: Readonly<Record<string, ContractField>>,
  owner: FieldOwner,
  lookups: MongoTypeLookups,
): void {
  for (const [fieldName, field] of Object.entries(fields)) {
    const { type: fieldType } = field;
    if (fieldType.kind !== 'scalar' || fieldType.typeParams === undefined) continue;
    const type = dataTypeOfCodec(fieldType.codecId, lookups);
    if (type !== undefined)
      assertDataTypeParams(type, fieldType.typeParams, { ...owner, fieldName });
  }
}

/** What is wrong with the type parameters `typeParams` for the data type the codec `codecId` represents, or undefined when it accepts them or the stack registers no such codec or data type. */
export function codecTypeParamsProblem(
  codecId: string,
  typeParams: Readonly<Record<string, unknown>>,
  lookups: MongoTypeLookups,
): DataTypeParamsProblem | undefined {
  const type = dataTypeOfCodec(codecId, lookups);
  return type === undefined ? undefined : dataTypeParamsProblem(type, typeParams);
}

function dataTypeOfCodec(codecId: string, lookups: MongoTypeLookups): DataType | undefined {
  const descriptor = lookups.codecLookup.descriptorFor(codecId);
  return descriptor === undefined ? undefined : lookups.dataTypeLookup.get(descriptor.dataType);
}
