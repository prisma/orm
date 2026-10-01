import type {
  AnyMongoTypeMaps,
  ExtractMongoTypeMaps,
  InferModelRow,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelsMap,
} from '@internal/mongo-contract';
import type { MongoAggAccumulator, MongoAggExpr } from '@internal/mongo-query-ast/execution';
import type { ModelArrayField, ModelOriginBrand, ModelOriginBranded } from './resolve-path';

export interface DocField {
  readonly codecId: string;
  readonly nullable: boolean;
}

export type NumericField = { readonly codecId: 'mongo/double@1'; readonly nullable: false };
export type NullableNumericField = { readonly codecId: 'mongo/double@1'; readonly nullable: true };
export type StringField = { readonly codecId: 'mongo/string@1'; readonly nullable: false };
export type ArrayField = { readonly codecId: 'mongo/array@1'; readonly nullable: false };
export type BooleanField = { readonly codecId: 'mongo/bool@1'; readonly nullable: false };
export type DateField = { readonly codecId: 'mongo/date@1'; readonly nullable: false };
export type NullableDocField = { readonly codecId: string; readonly nullable: true };

export type LiteralValue<F extends DocField> = F extends StringField
  ? string
  : F extends NumericField
    ? number
    : F extends BooleanField
      ? boolean
      : F extends DateField
        ? Date
        : unknown;

export type DocShape = Record<string, DocField>;

type ExtractCodecId<F> = F extends { type: { kind: 'scalar'; codecId: infer C } }
  ? C
  : F extends { codecId: infer C extends string }
    ? C
    : string;

export type ModelToDocShape<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  [K in keyof MongoModelsMap<TContract>[ModelName]['fields'] & string]: {
    readonly codecId: ExtractCodecId<MongoModelsMap<TContract>[ModelName]['fields'][K]>;
    readonly nullable: MongoModelsMap<TContract>[ModelName]['fields'][K]['nullable'];
  };
} & ModelOriginBranded<ModelName>;

/**
 * Per-field resolver. Walks `Shape`'s string keys, routing
 * `ModelArrayField` (the lookup marker) through `InferModelRow` and
 * everything else through the codec-lookup branch.
 *
 * Internal helper — public callers should use `ResolveRow`, which adds
 * the model-origin brand detection on top.
 */
type ResolveFields<
  Shape extends DocShape,
  CodecTypes extends Record<string, { readonly output: unknown }>,
  TContract extends MongoContract,
> = {
  -readonly [K in keyof Shape & string]: Shape[K] extends ModelArrayField<infer ModelName>
    ? IsConcreteContract<TContract> extends true
      ? TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>
        ? ModelName extends string & keyof MongoModelsMap<TContract>
          ? Array<InferModelRow<TContract, ModelName>>
          : unknown[]
        : unknown[]
      : unknown[]
    : Shape[K]['codecId'] extends keyof CodecTypes
      ? Shape[K]['nullable'] extends true
        ? CodecTypes[Shape[K]['codecId']]['output'] | null
        : CodecTypes[Shape[K]['codecId']]['output']
      : unknown;
};

/**
 * Resolve a `DocShape` to a concrete row object type.
 *
 * The optional `TContract` parameter exists so the resolver can:
 *
 *  1. Detect the `ModelOriginBrand` on `Shape` — the phantom symbol
 *     placed by `ModelToDocShape`. When present (and the contract has
 *     type maps), the row is resolved via `InferModelRow<TC, M>` from
 *     `@internal/mongo-contract`, which walks scalar / valueObject /
 *     union field kinds (handling nested value-objects and list fields).
 *     This makes entry-point reads (`q.from('users').build()`) and
 *     shape-extending stages (`match`, `addFields`) resolve value-object
 *     fields to their concrete nested types instead of `unknown`.
 *
 *  2. Detect the per-field `ModelArrayField<ModelName>` marker produced
 *     by `lookup()` and resolve it to `Array<InferModelRow<TC, M>>` so
 *     lookup rows carry the same fully-typed foreign rows.
 *
 * When the contract is not threaded through (or lacks the type-map
 * phantom), both branches fall back to `unknown` / `unknown[]` —
 * preserving the legacy resolver shape for call sites that do not need
 * model-row resolution.
 */
/**
 * Flatten an intersection `A & B` into a single object literal so callers
 * (and `expectTypeOf().toEqualTypeOf<…>()`) see one homogeneous record
 * rather than the intersection form. Vitest's strict equality check
 * treats `A & B` as distinct from the structurally-equivalent flat
 * record, even when assignability is bidirectional, so the
 * `ResolveRow` brand-positive branch normalises its result through this.
 */
type Flatten<T> = T extends infer U ? { [K in keyof U]: U[K] } : never;

/**
 * Decide whether to route a brand-positive `ResolveRow` through
 * `InferModelRow`. The default `MongoContract` (no concrete models)
 * still satisfies `MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>`
 * because the phantom key is optional, but `InferModelRow<MongoContract, …>`
 * collapses to an empty/unknown row. Gate on the presence of the
 * type-maps phantom: a concrete contract attaches concrete `TestTypeMaps`-
 * shaped maps, while the default `MongoContract` has no phantom and
 * `ExtractMongoTypeMaps` resolves to `never`.
 */
type IsConcreteContract<TContract> = [ExtractMongoTypeMaps<TContract>] extends [never]
  ? false
  : true;

export type ResolveRow<
  Shape extends DocShape,
  CodecTypes extends Record<string, { readonly output: unknown }>,
  TContract extends MongoContract = MongoContract,
> = Shape extends { readonly [ModelOriginBrand]?: infer ModelName extends string }
  ? IsConcreteContract<TContract> extends true
    ? TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>
      ? ModelName extends string & keyof MongoModelsMap<TContract>
        ? Flatten<
            InferModelRow<TContract, ModelName> &
              Omit<
                ResolveFields<Shape, CodecTypes, TContract>,
                keyof InferModelRow<TContract, ModelName>
              >
          >
        : ResolveFields<Shape, CodecTypes, TContract>
      : ResolveFields<Shape, CodecTypes, TContract>
    : ResolveFields<Shape, CodecTypes, TContract>
  : ResolveFields<Shape, CodecTypes, TContract>;

export interface TypedAggExpr<F extends DocField> {
  readonly _field: F;
  readonly node: MongoAggExpr;
}

export interface TypedAccumulatorExpr<F extends DocField> {
  readonly _field: F;
  readonly node: MongoAggAccumulator;
}

export type ExtractDocShape<T extends Record<string, TypedAggExpr<DocField>>> = {
  [K in keyof T & string]: T[K]['_field'];
};

export type SortSpec<S extends DocShape> = Partial<Record<keyof S & string, 1 | -1>>;

export type ProjectedShape<
  Shape extends DocShape,
  Spec extends Record<string, 1 | TypedAggExpr<DocField>>,
> = {
  [K in keyof Spec & string]: Spec[K] extends 1
    ? K extends keyof Shape
      ? Shape[K]
      : DocField
    : Spec[K] extends TypedAggExpr<infer F>
      ? F
      : DocField;
} & ('_id' extends keyof Shape
  ? '_id' extends keyof Spec
    ? Record<keyof never, never>
    : Pick<Shape, '_id'>
  : Record<keyof never, never>);

export type GroupSpec = {
  _id: TypedAggExpr<DocField> | null;
  [key: string]: TypedAggExpr<DocField> | TypedAccumulatorExpr<DocField> | null;
};

export type GroupedDocShape<Spec extends GroupSpec> = {
  [K in keyof Spec & string]: Spec[K] extends TypedAggExpr<infer F>
    ? F
    : Spec[K] extends TypedAccumulatorExpr<infer F>
      ? F
      : Spec[K] extends null
        ? { readonly codecId: 'mongo/null@1'; readonly nullable: true }
        : DocField;
};

/**
 * Intentionally identity — full array element type extraction is deferred.
 * Used by `UnwoundShape` so the unwind result shape can be refined later
 * without changing the public API.
 */
type UnwrapArrayDocField<F extends DocField> = F;

/**
 * `$unwind` reshapes the array slot but leaves the rest of the document
 * structurally intact. The mapped iteration is keyed on `keyof S & string`,
 * which discards the symbol-keyed `ModelOriginBrand` carried by
 * model-rooted shapes. Preserve the brand explicitly so post-unwind
 * `ResolveRow` still routes through `InferModelRow` and value-object
 * fields keep their concrete nested types.
 */
export type UnwoundShape<S extends DocShape, K extends keyof S & string> = {
  [P in keyof S & string]: P extends K ? UnwrapArrayDocField<S[P]> : S[P];
} & (S extends ModelOriginBranded<infer ModelName extends string>
  ? ModelOriginBranded<ModelName>
  : unknown);
