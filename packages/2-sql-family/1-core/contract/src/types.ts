import type { CodecTrait } from '@internal/framework-components/codec';
import type { ControlDriverInstance } from '@internal/framework-components/control';
import type { ForeignKeyIndex, ReferentialAction } from './ir/foreign-key';

export interface SqlControlDriverInstance<T extends string = string>
  extends ControlDriverInstance<'sql', T> {
  query<Row = Record<string, unknown>>(
    sql: string,
    params?: readonly unknown[],
  ): Promise<{ readonly rows: Row[] }>;
}

export { CheckConstraint, type CheckConstraintInput } from './ir/check-constraint';
export {
  ForeignKey,
  type ForeignKeyIndex,
  type ForeignKeyInput,
  type ReferentialAction,
} from './ir/foreign-key';
export {
  ForeignKeyReference,
  type ForeignKeyReferenceInput,
} from './ir/foreign-key-reference';
export { PrimaryKey, type PrimaryKeyInput } from './ir/primary-key';
export { Index, type IndexInput } from './ir/sql-index';
export { SqlNode } from './ir/sql-node';
export {
  isMaterializedSqlNamespace,
  isSqlAuthoringContributions,
  type SqlAuthoringContributions,
  type SqlNamespace,
  SqlNamespaceBase,
  type SqlNamespaceEntries,
  type SqlNamespaceFactory,
  type SqlNamespaceInput,
  SqlStorage,
  type SqlStorageInput,
  type SqlStorageTypeEntry,
} from './ir/sql-storage';
export { StorageColumn, type StorageColumnInput } from './ir/storage-column';
export { StorageTable, type StorageTableInput } from './ir/storage-table';
export {
  type AuthoredStorageTypeInstance,
  CODEC_INSTANCE_KIND,
  isStorageTypeInstance,
  nonEmptyTypeParams,
  type StorageTypeInstance,
  type StorageTypeInstanceInput,
  toStorageTypeInstance,
} from './ir/storage-type-instance';
export { StorageValueObject, type StorageValueObjectInput } from './ir/storage-value-object';
export {
  isStorageValueSet,
  StorageValueSet,
  type StorageValueSetInput,
} from './ir/storage-value-set';
export {
  UniqueConstraint,
  type UniqueConstraintInput,
} from './ir/unique-constraint';
export {
  checkConstraintInputFromSerialized,
  type SerializedCheckConstraint,
} from './serialized-check-constraint';
export { indexInputFromSerialized, type SerializedIndex } from './serialized-index';

export type ForeignKeyOptions = {
  readonly name?: string;
  readonly onDelete?: ReferentialAction;
  readonly onUpdate?: ReferentialAction;
  readonly index?: ForeignKeyIndex;
};

export type SqlModelFieldStorage = {
  readonly column: string;
  readonly codecId?: string;
  readonly nullable?: boolean;
};

export type SqlModelStorage = {
  readonly table: string;
  readonly namespaceId: string;
  readonly fields: Record<string, SqlModelFieldStorage>;
};

export const DEFAULT_FK_CONSTRAINT = true;
export const DEFAULT_FK_INDEX = true;

export function applyFkDefaults(
  fk: { constraint?: boolean | undefined; index?: boolean | string | undefined },
  overrideDefaults?: { constraint?: boolean | undefined; index?: boolean | undefined },
): { constraint: boolean; index: boolean | string } {
  return {
    constraint: fk.constraint ?? overrideDefaults?.constraint ?? DEFAULT_FK_CONSTRAINT,
    index: fk.index ?? overrideDefaults?.index ?? DEFAULT_FK_INDEX,
  };
}

// Field-type maps nested by namespace coordinate: `[namespaceId][model][field]`.
// Shared by the output and input field-type maps and their extractors.
export type NamespacedFieldTypeMap = Record<string, Record<string, Record<string, unknown>>>;

export type NamespacedStorageColumnTypeMap = Record<
  string,
  Record<string, Record<string, unknown>>
>;

/**
 * What one aggregate produces: the id of the codec its result carries, and whether that result can be null. The codec id is the whole of the result's identity — a `sum` leaves its input's type parameters behind, and a result that keeps them is one whose codec id is the input's own.
 */
export type AggregateResultType = {
  readonly output: string;
  readonly nullable: boolean;
};

/**
 * One aggregate operation's settled overloads.
 *
 * `byCodec` answers per input codec, precedence already applied: a codec claimed by an exact overload carries that overload's result, and one served by a trait fallback carries the fallback's. `anyInput` answers an input no row claims, and `withoutInput` answers a call that carries no input at all — `count()` over rows.
 *
 * Only codecs the composed stack contributes appear, so an availability this map advertises is one the runtime will honour.
 */
export type AggregateOperationTypes = {
  readonly byCodec: Record<string, AggregateResultType>;
  readonly withoutInput?: AggregateResultType;
  readonly anyInput?: AggregateResultType;
};

/** Aggregate operations keyed by name (`count`, `sum`, …). */
export type AggregateTypesBase = Record<string, AggregateOperationTypes>;

/** The parts of an aggregate descriptor its result type depends on. */
type AggregateOverload = {
  readonly operation: string;
  readonly input: { readonly kind: string; readonly codecId?: string; readonly trait?: string };
  readonly output: { readonly kind: string; readonly codecId?: string };
  readonly nullable: boolean;
};

/** A result as an overload declares it: a named codec, or `self` for the codec of the input it serves. */
type OverloadResult<Descriptor> = {
  readonly output: Descriptor extends {
    readonly output: { readonly kind: 'codec'; readonly codecId: infer Output };
  }
    ? Output
    : 'self';
  readonly nullable: Descriptor extends { readonly nullable: infer Nullable } ? Nullable : never;
};

type OperationsOf<Descriptors> = Descriptors extends {
  readonly operation: infer Name extends string;
}
  ? Name
  : never;

type ExactCodecIds<Descriptors> = Descriptors extends {
  readonly input: { readonly kind: 'codec'; readonly codecId: infer CodecId extends string };
}
  ? CodecId
  : never;

type ExactOverloads<Descriptors, CodecId> = Descriptors extends {
  readonly input: { readonly kind: 'codec'; readonly codecId: infer Claimed };
}
  ? CodecId extends Claimed
    ? Descriptors
    : never
  : never;

type ClaimedTraits<Descriptors> = Descriptors extends {
  readonly input: { readonly kind: 'trait'; readonly trait: infer Trait extends string };
}
  ? Trait
  : never;

type TraitOverloads<Descriptors, Trait> = Descriptors extends {
  readonly input: { readonly kind: 'trait'; readonly trait: infer Claimed };
}
  ? Trait extends Claimed
    ? Descriptors
    : never
  : never;

type InputlessOverload<Descriptors, Kind extends 'none' | 'any'> = Extract<
  Descriptors,
  { readonly input: { readonly kind: Kind } }
>;

// One operation's overloads, indexed by the codec or trait they claim. Built once per set of descriptors, so settling against a contract's codecs only looks rows up.
type OperationOverloads<Descriptors> = {
  readonly exact: {
    readonly [CodecId in ExactCodecIds<Descriptors>]: OverloadResult<
      ExactOverloads<Descriptors, CodecId>
    >;
  };
  readonly trait: {
    readonly [Trait in ClaimedTraits<Descriptors>]: OverloadResult<
      TraitOverloads<Descriptors, Trait>
    >;
  };
  readonly none: [InputlessOverload<Descriptors, 'none'>] extends [never]
    ? never
    : OverloadResult<InputlessOverload<Descriptors, 'none'>>;
  readonly any: [InputlessOverload<Descriptors, 'any'>] extends [never]
    ? never
    : OverloadResult<InputlessOverload<Descriptors, 'any'>>;
};

type OverloadTable<Descriptors> = {
  readonly [Operation in OperationsOf<Descriptors>]: OperationOverloads<
    Extract<Descriptors, { readonly operation: Operation }>
  >;
};

type IsUnionOf<T, Whole = T> = T extends unknown ? ([Whole] extends [T] ? false : true) : never;

type CodecTraitsOfId<CodecTypes, CodecId> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId] extends { readonly traits: infer Traits }
    ? Traits
    : never
  : never;

// The overload that serves a codec: its exact one, otherwise the one trait overload whose trait it carries. Two trait overloads that both claim it leave it unserved; emission refuses that contract.
type SettledResult<
  Overloads extends OperationOverloads<never>,
  CodecId,
  Traits,
> = CodecId extends keyof Overloads['exact']
  ? Overloads['exact'][CodecId]
  : Extract<keyof Overloads['trait'], Traits> extends infer Trait
    ? [Trait] extends [never]
      ? never
      : true extends IsUnionOf<Trait>
        ? never
        : Overloads['trait'][Trait & keyof Overloads['trait']]
    : never;

type SettledRow<Result, CodecId> = {
  readonly output: Result extends { readonly output: infer Output }
    ? Output extends 'self'
      ? CodecId
      : Output
    : never;
  readonly nullable: Result extends { readonly nullable: infer Nullable } ? Nullable : never;
};

type InputlessRows<Overloads extends OperationOverloads<never>> = ([Overloads['none']] extends [
  never,
]
  ? [Overloads['any']] extends [never]
    ? Record<never, never>
    : { readonly withoutInput: SettledRow<Overloads['any'], never> }
  : { readonly withoutInput: SettledRow<Overloads['none'], never> }) &
  ([Overloads['any']] extends [never]
    ? Record<never, never>
    : { readonly anyInput: SettledRow<Overloads['any'], never> });

type SettledOperation<Overloads extends OperationOverloads<never>, CodecTypes> = {
  readonly byCodec: {
    readonly [CodecId in (keyof CodecTypes & string) | (keyof Overloads['exact'] & string) as [
      SettledResult<Overloads, CodecId, CodecTraitsOfId<CodecTypes, CodecId>>,
    ] extends [never]
      ? never
      : CodecId]: SettledRow<
      SettledResult<Overloads, CodecId, CodecTraitsOfId<CodecTypes, CodecId>>,
      CodecId
    >;
  };
} & InputlessRows<Overloads>;

type SettledAggregateTypes<Table, CodecTypes> = {
  readonly [Operation in keyof Table]: Table[Operation] extends infer Overloads extends
    OperationOverloads<never>
    ? SettledOperation<Overloads, CodecTypes>
    : never;
};

/**
 * The aggregate result types of a stack, settled from the aggregate descriptors its components contribute against the codecs it composes, as emission writes them into `AggregateTypes`: an exact overload first, then the one trait overload a codec's traits select, and the overloads that take no input or any input. The codecs a row can key are the contract's and those an exact overload names, which the stack contributes though its codec type map may not list them.
 */
export type AggregateTypesFromDescriptors<
  Descriptors extends AggregateOverload,
  CodecTypes extends Record<string, unknown>,
> = SettledAggregateTypes<OverloadTable<Descriptors>, CodecTypes>;

export type TypeMaps<
  TCodecTypes extends Record<string, { output: unknown }> = Record<string, never>,
  TQueryOperationTypes extends Record<string, unknown> = Record<string, never>,
  TFieldOutputTypes extends NamespacedFieldTypeMap = Record<string, never>,
  TFieldInputTypes extends NamespacedFieldTypeMap = Record<string, never>,
  TStorageColumnTypes extends NamespacedStorageColumnTypeMap = Record<string, never>,
  TStorageColumnInputTypes extends NamespacedStorageColumnTypeMap = Record<string, never>,
  TAggregateTypes extends AggregateTypesBase = Record<string, never>,
> = {
  readonly codecTypes: TCodecTypes;
  readonly queryOperationTypes: TQueryOperationTypes;
  readonly fieldOutputTypes: TFieldOutputTypes;
  readonly fieldInputTypes: TFieldInputTypes;
  readonly storageColumnTypes: TStorageColumnTypes;
  readonly storageColumnInputTypes: TStorageColumnInputTypes;
  readonly aggregateTypes: TAggregateTypes;
};

export type AggregateTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly aggregateTypes: infer A }
    ? A extends AggregateTypesBase
      ? A
      : Record<string, never>
    : Record<string, never>;

export type CodecTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly codecTypes: infer C }
    ? C extends Record<string, { output: unknown }>
      ? C
      : Record<string, never>
    : Record<string, never>;

/**
 * Dispatch hint identifying the first-argument target of an operation.
 *
 * Used by ORM column helpers to decide whether an operation is reachable on a
 * field. Names a concrete codec identity, a set of capability traits the
 * field's codec must carry, or targets list-typed (`many`) fields. Element
 * capability gating for list ops travels in `elementTraits`.
 */
export type QueryOperationSelfSpec =
  | { readonly codecId: string; readonly traits?: never; readonly many?: never }
  | { readonly traits: readonly CodecTrait[]; readonly codecId?: never; readonly many?: never }
  | {
      readonly many: true;
      readonly elementTraits?: readonly CodecTrait[];
      readonly codecId?: never;
      readonly traits?: never;
    };

/**
 * Structural shape an operation's impl must return: any value carrying a
 * codec-exact `returnType` descriptor. `Expression<T>` (from
 * `@internal/sql-relational-core/expression`, with `T extends ScopeField`)
 * extends this. Trait-targeted returns are deliberately excluded — predicate
 * detection and result decoding both depend on knowing the concrete return
 * codec.
 */
export type QueryOperationReturn = {
  readonly returnType: { readonly codecId: string; readonly nullable: boolean };
};

export type QueryOperationTypeEntry = {
  readonly self?: QueryOperationSelfSpec;
  readonly impl: (...args: never[]) => QueryOperationReturn;
};

export type SqlQueryOperationTypes<
  _CT extends Record<string, { readonly input: unknown; readonly output: unknown }>,
  T extends Record<string, QueryOperationTypeEntry>,
> = T;

export type QueryOperationTypesBase = Record<string, QueryOperationTypeEntry>;

/**
 * A pack's query operation types as a function of the contract's codec types. A pack declares an interface extending this one whose `queryOperationTypes` reads `this['codecTypes']`; {@link ApplyQueryOperationTypes} supplies the codec types.
 */
export interface QueryOperationTypesFunction {
  readonly codecTypes: Record<never, { readonly input: unknown; readonly output: unknown }>;
  readonly queryOperationTypes: Record<string, unknown>;
}

export type ApplyQueryOperationTypes<
  TypeFunction extends QueryOperationTypesFunction,
  CodecTypes extends Record<string, { readonly input: unknown; readonly output: unknown }>,
> = (TypeFunction & { readonly codecTypes: CodecTypes })['queryOperationTypes'];

export type QueryOperationTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly queryOperationTypes: infer Q }
    ? Q extends Record<string, unknown>
      ? Q
      : Record<string, never>
    : Record<string, never>;

export type TypeMapsPhantomKey = '__@internal/sql-contract/typeMaps@__';

export type ContractWithTypeMaps<TContract, TTypeMaps> = TContract & {
  readonly [K in TypeMapsPhantomKey]?: TTypeMaps;
};

export type ExtractTypeMapsFromContract<T> = TypeMapsPhantomKey extends keyof T
  ? NonNullable<T[TypeMapsPhantomKey & keyof T]>
  : never;

export type FieldOutputTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly fieldOutputTypes: infer F }
    ? F extends NamespacedFieldTypeMap
      ? F
      : Record<string, never>
    : Record<string, never>;

export type FieldInputTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly fieldInputTypes: infer F }
    ? F extends NamespacedFieldTypeMap
      ? F
      : Record<string, never>
    : Record<string, never>;

export type StorageColumnTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly storageColumnTypes: infer F }
    ? F extends NamespacedStorageColumnTypeMap
      ? F
      : Record<string, never>
    : Record<string, never>;

export type StorageColumnInputTypesOf<T> = [T] extends [never]
  ? Record<string, never>
  : T extends { readonly storageColumnInputTypes: infer F }
    ? F extends NamespacedStorageColumnTypeMap
      ? F
      : Record<string, never>
    : Record<string, never>;

export type ExtractCodecTypes<T> = CodecTypesOf<ExtractTypeMapsFromContract<T>>;
export type ExtractQueryOperationTypes<T> = QueryOperationTypesOf<ExtractTypeMapsFromContract<T>>;
export type ExtractFieldOutputTypes<T> = FieldOutputTypesOf<ExtractTypeMapsFromContract<T>>;
export type ExtractFieldInputTypes<T> = FieldInputTypesOf<ExtractTypeMapsFromContract<T>>;
export type ExtractStorageColumnTypes<T> = StorageColumnTypesOf<ExtractTypeMapsFromContract<T>>;
export type ExtractStorageColumnInputTypes<T> = StorageColumnInputTypesOf<
  ExtractTypeMapsFromContract<T>
>;
export type ExtractAggregateTypes<T> = AggregateTypesOf<ExtractTypeMapsFromContract<T>>;

export type ResolveCodecTypes<TContract, TTypeMaps> = [TTypeMaps] extends [never]
  ? ExtractCodecTypes<TContract>
  : CodecTypesOf<TTypeMaps>;
