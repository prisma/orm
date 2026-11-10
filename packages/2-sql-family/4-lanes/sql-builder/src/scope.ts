import type {
  AggregateTypesBase,
  QueryOperationTypesBase,
  StorageTable,
} from '@internal/sql-contract/types';
import type { AnyFromSource } from '@internal/sql-relational-core/ast';
import type {
  CodecTypesBase,
  ScopeField,
  StorageColumnScopeField,
} from '@internal/sql-relational-core/expression';

export type { ScopeField };

export type TraitField = { traits: readonly string[]; nullable: boolean };
export type FieldSpec = ScopeField | TraitField;

export type GatedMethod<Capabilities, Required, Method> = Capabilities extends Required
  ? Method
  : never;

export declare const JoinOuterScope: unique symbol;

/** Contract-resolved output carried by a field, independent of its projection alias. */
export declare const fieldOutput: unique symbol;

export type Expand<T> = { [K in keyof T]: T[K] } & unknown;
export type EmptyRow = Record<never, ScopeField>;

export type ScopeTable = Record<string, ScopeField>;

export type Scope = {
  topLevel: ScopeTable;
  namespaces: Record<string, ScopeTable>;
};

export type JoinSource<Row extends ScopeTable, Alias extends string> = {
  readonly [JoinOuterScope]: {
    topLevel: Row;
    namespaces: Record<Alias, Row>;
  };

  getJoinOuterScope(): Scope;
  buildAst(): AnyFromSource;
};

export type DefaultScope<
  Name extends string,
  Table extends StorageTable,
  Outputs extends Record<string, unknown> = Record<string, never>,
> = {
  topLevel: StorageTableToScopeTable<Table, Outputs>;
  namespaces: {
    [K in Name]: StorageTableToScopeTable<Table, Outputs>;
  };
};

export type StorageTableToScopeTable<
  T extends StorageTable,
  Outputs extends Record<string, unknown> = Record<string, never>,
> = {
  [K in keyof T['columns']]: StorageColumnScopeField<T['columns'][K]> &
    (string extends keyof Outputs
      ? Record<never, never>
      : K extends keyof Outputs
        ? { readonly [fieldOutput]?: { readonly output: Outputs[K] } }
        : Record<never, never>);
};

export type MergeScopes<A extends Scope, B extends Scope> = {
  topLevel: Expand<
    Omit<A['topLevel'], keyof B['topLevel']> & Omit<B['topLevel'], keyof A['topLevel']>
  >;
  namespaces: Expand<A['namespaces'] & B['namespaces']>;
};

export type RebindScope<S extends Scope, OldKey extends string, NewKey extends string> = {
  topLevel: S['topLevel'];
  namespaces: Expand<Omit<S['namespaces'], OldKey> & Record<NewKey, S['namespaces'][OldKey]>>;
};

export type NullableScopeTable<S extends ScopeTable> = {
  [K in keyof S]: {
    codecId: S[K]['codecId'];
    nullable: true;
  } & (typeof fieldOutput extends keyof S[K]
    ? Pick<S[K], typeof fieldOutput & keyof S[K]>
    : Record<never, never>);
};

export type NullableScope<S extends Scope> = {
  topLevel: NullableScopeTable<S['topLevel']>;
  namespaces: {
    [TableName in keyof S['namespaces']]: NullableScopeTable<S['namespaces'][TableName]>;
  };
};

export type QueryContext = {
  readonly codecTypes: CodecTypesBase;
  readonly capabilities: Record<string, Record<string, boolean>>;
  readonly queryOperationTypes: QueryOperationTypesBase;
  readonly resolvedColumnOutputTypes: Record<string, unknown>;
  /** The aggregate result map the contract emits, settled per operation and input codec. */
  readonly aggregateTypes: AggregateTypesBase;
};

export type { StorageTable };
