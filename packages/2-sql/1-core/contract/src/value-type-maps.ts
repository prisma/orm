import type {
  ParameterizedOutputTypesFunction,
  StoredValueType,
  ValueTypeSide,
} from '@internal/contract/types';

type Lookup<T, Key> = Key extends keyof T ? T[Key] : never;

type TypeParamsOf<T> = T extends { readonly typeParams: infer TypeParams } ? TypeParams : undefined;

type ColumnTypeParams<Column, StorageTypes> = Column extends {
  readonly typeParams: infer TypeParams;
}
  ? TypeParams
  : Column extends { readonly typeRef: infer TypeRef }
    ? TypeParamsOf<Lookup<StorageTypes, TypeRef>>
    : undefined;

type TablesOf<Namespace> = Lookup<Lookup<Namespace, 'entries'>, 'table'>;

/**
 * `StorageColumnTypes` (`Side` `'output'`) or `StorageColumnInputTypes` (`'input'`) of a contract whose storage is `Storage`, by the rules of `FieldTypesFromDomain` (`@internal/contract/types`), with `Overrides` keyed by namespace, table and column. A column typed by a named storage type takes that type's parameters.
 */
export type ColumnTypesFromStorage<
  Storage,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Overrides,
  Side extends ValueTypeSide,
> = {
  readonly [Ns in keyof Lookup<Storage, 'namespaces'>]: {
    readonly [T in keyof TablesOf<Lookup<Storage, 'namespaces'>[Ns]>]: {
      readonly [C in keyof Lookup<
        TablesOf<Lookup<Storage, 'namespaces'>[Ns]>[T],
        'columns'
      >]: Lookup<TablesOf<Lookup<Storage, 'namespaces'>[Ns]>[T], 'columns'>[C] extends infer Column
        ? StoredValueType<
            Column,
            Lookup<Column, 'codecId'>,
            ColumnTypeParams<Column, NonNullable<Lookup<Storage, 'types'>>>,
            Lookup<Lookup<Lookup<Overrides, Ns>, T>, C>,
            CodecTypes,
            ParameterizedOutputs,
            Side
          >
        : never;
    };
  };
};
