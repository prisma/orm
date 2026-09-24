import type { Contract, ContractModel, StorageBase } from '@internal/contract/types';
import type { Namespace, UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type { MongoIndexOptionsInput } from './ir/mongo-index-options';

export type MongoIndexFieldValue = 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed';

export type MongoIndexFields = Record<string, MongoIndexFieldValue>;

export type MongoJsonPrimitive = string | number | boolean | null;

export type MongoJsonValue = MongoJsonPrimitive | readonly MongoJsonValue[] | MongoJsonObject;

export type MongoJsonObject = {
  readonly [key: string]: MongoJsonValue;
};

export type MongoWildcardProjection = Readonly<Record<string, 0 | 1>>;

/**
 * Authoring-DSL shape for a single index entry on a model — the
 * `indexes` array element accepted by the contract-ts builder. The
 * builder translates these (with model context) into {@link MongoIndex}
 * IR-class instances on `MongoCollection.indexes`.
 */
export type MongoIndexAuthoringInput = {
  readonly fields: MongoIndexFields;
  readonly options?: MongoIndexOptionsInput;
};

export type MongoIndexKeyDirection = 1 | -1 | 'text' | '2dsphere' | '2d' | 'hashed';

export interface MongoIndexKey {
  readonly field: string;
  readonly direction: MongoIndexKeyDirection;
}

export type MongoModelStorage = {
  readonly collection?: string;
  readonly relations?: Record<string, { readonly field: string }>;
};

export type MongoModelDefinition = ContractModel<MongoModelStorage>;

/**
 * Data-shape constraint for the Mongo family's storage block. The
 * runtime in-memory representation is the concrete {@link MongoStorage}
 * class from `./ir/mongo-storage`; this type is the structural superset
 * used as the generic-parameter constraint so consumers can name
 * `MongoContract<...>` over either the raw JSON envelope (no
 * `namespaces` field) or a fully-constructed class instance (with
 * `namespaces`). The class structurally satisfies this shape.
 */
import type { MongoCollection } from './ir/mongo-collection';

type MongoNamespaceEntries = Readonly<Record<string, Readonly<Record<string, unknown>>>> & {
  readonly collection?: Readonly<Record<string, MongoCollection>>;
};

export type MongoStorageShape<THash extends string = string> = StorageBase<THash> & {
  readonly namespaces: Record<
    string,
    Namespace & {
      readonly entries: MongoNamespaceEntries;
    }
  >;
};

export type MongoContract<S extends MongoStorageShape = MongoStorageShape> = Contract<S>;

/**
 * Model map for the contract's sole (unbound) domain namespace. Mongo is
 * structurally single-namespace, so its models live under
 * {@link UNBOUND_NAMESPACE_ID} rather than in a flat cross-namespace union.
 * Every Mongo type that needs the model map reads it through here, so none
 * indexes the contract's namespaces directly.
 */
export type MongoModelsMap<TContract extends MongoContract> =
  TContract['domain']['namespaces'][typeof UNBOUND_NAMESPACE_ID]['models'];

export type RootModelName<
  TContract extends MongoContract,
  RootName extends keyof TContract['roots'] & string,
> = TContract['roots'][RootName] extends { readonly model: infer M extends string }
  ? M & keyof MongoModelsMap<TContract>
  : never;

export type MongoTypeMaps<
  TCodecTypes extends Record<string, { output: unknown }>,
  TFieldOutputTypes extends Record<string, Record<string, unknown>>,
  TFieldInputTypes extends Record<string, Record<string, unknown>>,
> = {
  readonly codecTypes: TCodecTypes;
  readonly fieldOutputTypes: TFieldOutputTypes;
  readonly fieldInputTypes: TFieldInputTypes;
};

export type AnyMongoTypeMaps = MongoTypeMaps<
  Record<string, { output: unknown }>,
  Record<string, Record<string, unknown>>,
  Record<string, Record<string, unknown>>
>;

export type MongoTypeMapsPhantomKey = '__@internal/mongo-core/typeMaps@__';

export type MongoContractWithTypeMaps<TContract, TTypeMaps> = TContract & {
  readonly [K in MongoTypeMapsPhantomKey]?: TTypeMaps;
};

export type ExtractMongoTypeMaps<T> = MongoTypeMapsPhantomKey extends keyof T
  ? NonNullable<T[MongoTypeMapsPhantomKey & keyof T]>
  : never;

export type ExtractMongoCodecTypes<T> =
  ExtractMongoTypeMaps<T> extends { codecTypes: infer C }
    ? C extends Record<string, { output: unknown }>
      ? C
      : Record<string, never>
    : Record<string, never>;

export type ExtractMongoFieldOutputTypes<T> =
  ExtractMongoTypeMaps<T> extends { fieldOutputTypes: infer F }
    ? F extends Record<string, Record<string, unknown>>
      ? F
      : Record<string, never>
    : Record<string, never>;

export type ExtractMongoFieldInputTypes<T> =
  ExtractMongoTypeMaps<T> extends { fieldInputTypes: infer F }
    ? F extends Record<string, Record<string, unknown>>
      ? F
      : Record<string, never>
    : Record<string, never>;

/**
 * The per-model field-output map at the contract's unbound namespace. The
 * framework emitter nests `FieldOutputTypes` by namespace id
 * (`{ [ns]: { [model]: { [field]: <refined> } } }`); Mongo is structurally
 * single-namespace, so its refined rows resolve the per-model map under
 * {@link UNBOUND_NAMESPACE_ID}. A map without that coordinate (e.g. a contract
 * carrying no type maps) resolves to `never`, which the row resolvers read as
 * "no refined map" and fall back to codec-based inference.
 */
export type MongoUnboundFieldOutputTypes<T> =
  ExtractMongoFieldOutputTypes<T> extends Record<typeof UNBOUND_NAMESPACE_ID, infer Inner>
    ? Inner
    : never;

/** Input-side counterpart of {@link MongoUnboundFieldOutputTypes}. */
export type MongoUnboundFieldInputTypes<T> =
  ExtractMongoFieldInputTypes<T> extends Record<typeof UNBOUND_NAMESPACE_ID, infer Inner>
    ? Inner
    : never;

export type InferModelRow<
  TContract extends MongoContractWithTypeMaps<
    MongoContract,
    MongoTypeMaps<
      Record<string, { output: unknown }>,
      Record<string, Record<string, unknown>>,
      Record<string, Record<string, unknown>>
    >
  >,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = ModelName extends keyof MongoUnboundFieldOutputTypes<TContract>
  ? MongoUnboundFieldOutputTypes<TContract>[ModelName]
  : // Only reachable for a contract with no MongoTypeMaps phantom key (e.g. validateContract<MongoContract>).
    { readonly [K in keyof MongoModelsMap<TContract>[ModelName]['fields']]: unknown };
