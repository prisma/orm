import type { JsonValue as FrameworkJsonValue } from '@internal/contract/types';
import type { JsonValue as TargetJsonValue } from '@internal/target-postgres/codec-types';
import { expectTypeOf, test } from 'vitest';
import type {
  Bit,
  Char,
  CodecTypes,
  ColumnTypesFromStorage,
  Contract,
  ContractWithTypeMaps,
  ExecutionHashBase,
  FieldTypesFromDomain,
  JsonValue,
  NamespaceId,
  Numeric,
  ParameterizedOutputTypesForTypeParams,
  ProfileHashBase,
  QueryOperationTypes,
  RelationKeys,
  StorageHashBase,
  Timetz,
  TypeMaps,
  ValueObjectTypesFromStorage,
  VarBit,
  Varchar,
} from '../src/exports/generated-types';

export type {
  Bit,
  Char,
  CodecTypes,
  ColumnTypesFromStorage,
  Contract,
  ContractWithTypeMaps,
  ExecutionHashBase,
  FieldTypesFromDomain,
  NamespaceId,
  Numeric,
  ParameterizedOutputTypesForTypeParams,
  ProfileHashBase,
  QueryOperationTypes,
  RelationKeys,
  StorageHashBase,
  Timetz,
  TypeMaps,
  ValueObjectTypesFromStorage,
  VarBit,
  Varchar,
};

test('JsonValue is the one type the framework and the target both export', () => {
  expectTypeOf<TargetJsonValue>().toEqualTypeOf<FrameworkJsonValue>();
  expectTypeOf<JsonValue>().toEqualTypeOf<FrameworkJsonValue>();
});
