import type { JsonValue as SqliteJsonValue } from '@internal/adapter-sqlite/codec-types';
import { expectTypeOf, test } from 'vitest';
import type {
  CodecTypes,
  ColumnTypesFromStorage,
  Contract,
  ContractWithTypeMaps,
  ExecutionHashBase,
  FieldTypesFromDomain,
  JsonValue,
  NamespaceId,
  ProfileHashBase,
  RelationKeys,
  StorageHashBase,
  TypeMaps,
  ValueObjectTypesFromStorage,
} from '../src/exports/generated-types';

export type {
  CodecTypes,
  ColumnTypesFromStorage,
  Contract,
  ContractWithTypeMaps,
  ExecutionHashBase,
  FieldTypesFromDomain,
  NamespaceId,
  ProfileHashBase,
  RelationKeys,
  StorageHashBase,
  TypeMaps,
  ValueObjectTypesFromStorage,
};

test('JsonValue is the SQLite codec types one, not the framework one', () => {
  expectTypeOf<JsonValue>().toEqualTypeOf<SqliteJsonValue>();
});
