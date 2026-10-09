import type {
  AggregateTypesBase,
  QueryOperationTypesBase,
  StorageTable,
} from '@internal/sql-contract/types';
import type { AnyFromSource } from '@internal/sql-relational-core/ast';
import type { CodecTypesBase, ScopeField } from '@internal/sql-relational-core/expression';

export type { ScopeField };

export type TraitField = { traits: readonly string[]; nullable: boolean };
export type FieldSpec = ScopeField | TraitField;

export type GatedMethod<Capabilities, Required, Method> = Capabilities extends Required
  ? Method
  : never;

export declare const JoinOuterScope: unique symbol;

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

export type DefaultScope<Name extends string, Table extends StorageTable> = {
  topLevel: StorageTableToScopeTable<Table>;
  namespaces: {
    [K in Name]: StorageTableToScopeTable<Table>;
  };
};

export type StorageTableToScopeTable<T extends StorageTable> = {
  [K in keyof T['columns']]: {
    codecId: T['columns'][K]['codecId'];
    nullable: T['columns'][K]['nullable'];
  } & (T['columns'][K] extends { many: true } ? { many: true } : Record<never, never>);
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
  [K in keyof S]: { codecId: S[K]['codecId']; nullable: true };
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
