import type { Contract } from '@internal/contract/types';
import type { ParamSpec } from '@internal/operations';
import type {
  ExtractFieldOutputTypes,
  SqlStorage,
  StorageColumn,
} from '@internal/sql-contract/types';
import type { SqlLoweringSpec } from '@internal/sql-operations';
import type { ColumnRef, ParamRef } from './ast/types';
import type { ExecutionContext } from './query-lane-context';
import type { SqlExecutionPlan } from './sql-execution-plan';

export type Expr = ColumnRef | ParamRef;

/**
 * The minimal contract shape the per-namespace column resolver needs: the
 * application-domain models and the storage tables, both keyed by namespace
 * coordinate, plus (via the optional TypeMaps phantom key, read structurally by
 * {@link ExtractFieldOutputTypes}) the refined field-output map. Every emitted
 * `Contract<SqlStorage>` satisfies it, as does `sql-builder`'s `TableProxyContract`
 * — so the resolver indexes the coordinate directly without forcing callers to
 * carry the full `Contract`.
 */
export type ColumnResolutionContract = {
  readonly domain: {
    readonly namespaces: Readonly<
      Record<string, { readonly models: Readonly<Record<string, unknown>> }>
    >;
  };
  readonly storage: {
    readonly namespaces: Readonly<
      Record<
        string,
        { readonly entries: Readonly<Record<string, Readonly<Record<string, unknown>>>> }
      >
    >;
  };
};

type NamespaceModels<
  TContract extends ColumnResolutionContract,
  NsId extends string,
> = TContract['domain']['namespaces'][NsId] extends {
  readonly models: infer Models extends Record<string, unknown>;
}
  ? Models
  : never;

type ExtractTableToModel<
  TContract extends ColumnResolutionContract,
  NsId extends string,
  TableName extends string,
> =
  NamespaceModels<TContract, NsId> extends infer Models extends Record<string, unknown>
    ? {
        [M in keyof Models & string]: Models[M] extends {
          readonly storage: { readonly table: TableName };
        }
          ? M
          : never;
      }[keyof Models & string]
    : never;

type ExtractColumnToField<
  TContract extends ColumnResolutionContract,
  NsId extends string,
  TableName extends string,
  ColumnName extends string,
> =
  ExtractTableToModel<TContract, NsId, TableName> extends infer ModelName extends string
    ? NamespaceModels<TContract, NsId> extends infer Models extends Record<string, unknown>
      ? ModelName & keyof Models extends infer MKey extends string
        ? Models[MKey] extends {
            readonly storage: { readonly fields: infer Fields extends Record<string, unknown> };
          }
          ? {
              [F in keyof Fields & string]: Fields[F] extends { readonly column: ColumnName }
                ? F
                : never;
            }[keyof Fields & string]
          : never
        : never
      : never
    : never;

/** Resolves to `never` when the table or column is absent in the namespace. */
type NamespaceStorageColumn<
  TContract extends ColumnResolutionContract,
  NsId extends string,
  TableName extends string,
  ColumnName extends string,
> = TContract['storage']['namespaces'][NsId] extends {
  readonly entries: { readonly table: infer Tables extends Record<string, unknown> };
}
  ? TableName extends keyof Tables
    ? Tables[TableName] extends {
        readonly columns: infer Columns extends Record<string, unknown>;
      }
      ? ColumnName extends keyof Columns
        ? Columns[ColumnName] extends StorageColumn
          ? Columns[ColumnName]
          : never
        : never
      : never
    : never
  : never;

type FallbackCodecLookup<
  ColumnMeta extends StorageColumn,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> = ColumnMeta extends { codecId: infer CodecId extends string }
  ? CodecId extends keyof CodecTypes
    ? CodecTypes[CodecId] extends { readonly output: infer O }
      ? ColumnMeta extends { nullable: true }
        ? O | null
        : O
      : unknown
    : unknown
  : unknown;

/**
 * The refined (typeParam-applied) JS output type for a field within a namespace
 * coordinate, read from the emitter's namespace-nested `FieldOutputTypes` map at
 * `FieldOutputTypes[NsId][Model][Field]`. This preserves parameterized codec
 * refinements (e.g. `Vector<N>`, `Char<N>`) that a bare codec-output lookup
 * would drop. Resolves to `never` when the coordinate is absent from the map.
 */
type NamespaceFieldOutput<
  TContract extends ColumnResolutionContract,
  NsId extends string,
  ModelName extends string,
  FieldName extends string,
> =
  ExtractFieldOutputTypes<TContract> extends infer Outputs
    ? NsId extends keyof Outputs
      ? Outputs[NsId] extends infer NamespaceOutputs
        ? ModelName extends keyof NamespaceOutputs
          ? NamespaceOutputs[ModelName] extends infer ModelOutputs
            ? FieldName extends keyof ModelOutputs
              ? ModelOutputs[FieldName]
              : never
            : never
          : never
        : never
      : never
    : never;

/**
 * The secondary resolution path, taken for a storage column not backed by a
 * domain model field in the namespace (e.g. a column with no corresponding
 * field); refined model fields resolve via {@link NamespaceFieldOutput}.
 */
type ColumnCodecFallback<
  TContract extends ColumnResolutionContract,
  NsId extends string,
  TableName extends string,
  ColumnName extends string,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> =
  NamespaceStorageColumn<TContract, NsId, TableName, ColumnName> extends infer ColumnMeta
    ? [ColumnMeta] extends [never]
      ? never
      : ColumnMeta extends StorageColumn
        ? FallbackCodecLookup<ColumnMeta, CodecTypes>
        : never
    : never;

/**
 * Type-level operation signature.
 * Represents an operation at the type level for use in contract type maps.
 */
export type OperationTypeSignature = {
  readonly args: ReadonlyArray<ParamSpec>;
  readonly returns: ParamSpec;
  readonly lowering: SqlLoweringSpec;
  readonly capabilities?: ReadonlyArray<string>;
};

/**
 * Type-level operation registry.
 * Maps typeId → operations, where operations is a record of method name → operation signature.
 *
 * Example:
 * ```typescript
 * type MyOperations: OperationTypes = {
 *   'pg/vector@1': {
 *     cosineDistance: {
 *       args: [{ codecId: 'pg/vector@1'; nullable: false }];
 *       returns: { codecId: 'core/float8'; nullable: false };
 *       lowering: { targetFamily: 'sql'; template: '...' };
 *     };
 *   };
 * };
 * ```
 */
export type OperationTypes = Record<string, Record<string, OperationTypeSignature>>;

/**
 * CodecTypes represents a map of typeId to codec definitions.
 * Each codec definition must have an `output` property indicating the JavaScript type.
 *
 * Example:
 * ```typescript
 * type MyCodecTypes: CodecTypes = {
 *   'pg/int4@1': { output: number };
 *   'pg/text@1': { output: string };
 * };
 * ```
 */
export type CodecTypes = Record<string, { readonly output: unknown }>;

/**
 * Extracts operations for a given typeId from the operation registry.
 * Returns an empty record if the typeId is not found.
 *
 * @example
 * ```typescript
 * type Ops = OperationsForTypeId<'pg/vector@1', MyOperations>;
 * // Ops = { cosineDistance: { ... }, l2Distance: { ... } }
 * ```
 */
export type OperationsForTypeId<TypeId extends string, Operations extends OperationTypes> =
  Operations extends Record<string, never>
    ? Record<string, never>
    : TypeId extends keyof Operations
      ? Operations[TypeId]
      : Record<string, never>;

/**
 * Resolves the JavaScript output type of a column addressed by an explicit
 * namespace coordinate.
 *
 * The table→model and column→field mapping is resolved per-namespace from
 * `domain.namespaces[NsId]['models']`, and the refined output type from the
 * emitter's namespace-nested `FieldOutputTypes[NsId][Model][Field]` — so a bare
 * table name shared across namespaces resolves to each namespace's own field,
 * and parameterized codec refinements (e.g. `Vector<N>`) are preserved. A
 * storage column not backed by a model field in the namespace falls back to a
 * codec-output lookup; a column absent in the namespace resolves to `never`.
 */
export type ComputeColumnJsType<
  TContract extends ColumnResolutionContract,
  NsId extends string,
  TableName extends string,
  ColumnName extends string,
  CodecTypes extends Record<string, { readonly output: unknown }>,
> =
  ExtractTableToModel<TContract, NsId, TableName> extends infer ModelName
    ? [ModelName] extends [never]
      ? ColumnCodecFallback<TContract, NsId, TableName, ColumnName, CodecTypes>
      : ModelName extends string
        ? ExtractColumnToField<TContract, NsId, TableName, ColumnName> extends infer FieldName
          ? [FieldName] extends [never]
            ? ColumnCodecFallback<TContract, NsId, TableName, ColumnName, CodecTypes>
            : FieldName extends string
              ? NamespaceFieldOutput<TContract, NsId, ModelName, FieldName> extends infer Out
                ? [Out] extends [never]
                  ? ColumnCodecFallback<TContract, NsId, TableName, ColumnName, CodecTypes>
                  : Out
                : never
              : never
          : never
        : never
    : never;

/**
 * Alias for the SQL-domain executable plan, exposed under the legacy
 * `SqlPlan` name for compatibility with SQL builder/utility call sites.
 * The canonical name is `SqlExecutionPlan` (`./sql-execution-plan`).
 */
export type SqlPlan<Row = unknown> = SqlExecutionPlan<Row>;

/**
 * Helper types for extracting contract structure.
 */
export type TablesOf<TContract> = TContract extends {
  storage: { tables: infer U };
}
  ? U
  : never;

export type TableKey<TContract> = Extract<keyof TablesOf<TContract>, string>;

// Common types for contract.d.ts generation (SQL-specific)
// These types are used by emitted contract.d.ts files to provide type-safe DSL/ORM types

/**
 * Unique symbol for metadata property to avoid collisions with user-defined properties
 */
export declare const META: unique symbol;

/**
 * Extracts metadata from a type that has a META property
 */
export type Meta<T extends { [META]: unknown }> = T[typeof META];

/**
 * Metadata interface for table definitions
 */
export interface TableMetadata<Name extends string> {
  name: Name;
}

/**
 * Metadata interface for model definitions
 */
export interface ModelMetadata<Name extends string> {
  name: Name;
}

/**
 * Base interface for table definitions with metadata
 * Used in contract.d.ts to define storage-level table types
 */
export interface TableDef<Name extends string> {
  readonly [META]: TableMetadata<Name>;
}

/**
 * Base interface for model definitions with metadata
 * Used in contract.d.ts to define application-level model types
 */
export interface ModelDef<Name extends string> {
  readonly [META]: ModelMetadata<Name>;
}

export type ColumnsOf<
  TContract,
  K extends TableKey<TContract>,
> = K extends keyof TablesOf<TContract>
  ? TablesOf<TContract>[K] extends { columns: infer C }
    ? C
    : never
  : never;

export interface BuildParamsMap {
  readonly [name: string]: unknown;
}

export interface BuildOptions {
  readonly params?: BuildParamsMap;
}

export interface SqlBuilderOptions<TContract extends Contract<SqlStorage> = Contract<SqlStorage>> {
  readonly context: ExecutionContext<TContract>;
}
