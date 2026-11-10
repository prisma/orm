import type { ContractReferenceRelation } from '@internal/contract/types';
import type {
  AnyMongoTypeMaps,
  ExtractMongoCodecTypes,
  InferModelRow,
  MongoContract,
  MongoContractWithTypeMaps,
  MongoModelsMap,
  MongoUnboundFieldInputTypes,
  MongoUnboundFieldOutputTypes,
  OwnFieldStoredAs,
} from '@internal/mongo-contract';

type Simplify<T> = T extends unknown ? { [K in keyof T]: T[K] } : never;

type ModelRelations<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = NonNullable<MongoModelsMap<TContract>[ModelName]['relations']>;

export type ReferenceRelationKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  [K in keyof ModelRelations<TContract, ModelName>]: ModelRelations<
    TContract,
    ModelName
  >[K] extends ContractReferenceRelation
    ? K
    : never;
}[keyof ModelRelations<TContract, ModelName>];

export type EmbedRelationKeys<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  [K in keyof ModelRelations<TContract, ModelName>]: ModelRelations<
    TContract,
    ModelName
  >[K] extends ContractReferenceRelation
    ? never
    : K;
}[keyof ModelRelations<TContract, ModelName>];

type ResolvedOutputRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = string extends keyof MongoUnboundFieldOutputTypes<TContract>
  ? InferModelRow<TContract, ModelName>
  : ModelName extends keyof MongoUnboundFieldOutputTypes<TContract>
    ? {
        -readonly [K in keyof MongoUnboundFieldOutputTypes<TContract>[ModelName]]: MongoUnboundFieldOutputTypes<TContract>[ModelName][K];
      }
    : InferModelRow<TContract, ModelName>;

type ResolvedInputRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = string extends keyof MongoUnboundFieldInputTypes<TContract>
  ? InferModelRow<TContract, ModelName>
  : ModelName extends keyof MongoUnboundFieldInputTypes<TContract>
    ? {
        -readonly [K in keyof MongoUnboundFieldInputTypes<TContract>[ModelName]]: MongoUnboundFieldInputTypes<TContract>[ModelName][K];
      }
    : InferModelRow<TContract, ModelName>;

type RelationTargetModel<TContract extends MongoContract, R> = R extends {
  readonly to: { readonly model: infer M extends string & keyof MongoModelsMap<TContract> };
}
  ? M
  : never;

type EmbedRelationRowType<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  RelKey extends keyof ModelRelations<TContract, ModelName>,
> = ModelRelations<TContract, ModelName>[RelKey] extends infer R
  ? R extends { readonly cardinality: infer C }
    ? ModelRelations<TContract, ModelName>[RelKey] extends ContractReferenceRelation
      ? never
      : RelationTargetModel<TContract, R> extends infer To extends string &
            keyof MongoModelsMap<TContract>
        ? C extends '1:N'
          ? ResolvedOutputRow<TContract, To>[]
          : ResolvedOutputRow<TContract, To>
        : never
    : never
  : never;

export type InferFullRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> =
  EmbedRelationKeys<TContract, ModelName> extends never
    ? ResolvedOutputRow<TContract, ModelName>
    : ResolvedOutputRow<TContract, ModelName> & {
        -readonly [K in EmbedRelationKeys<TContract, ModelName> &
          keyof ModelRelations<TContract, ModelName>]: EmbedRelationRowType<
          TContract,
          ModelName,
          K
        >;
      };

type VariantRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly discriminator: { readonly field: infer DiscField extends string };
  readonly variants: infer V;
}
  ? V extends Record<string, { readonly model: string }>
    ? {
        [Value in keyof V & string]: V[Value]['model'] extends infer VK extends string &
          keyof MongoModelsMap<TContract>
          ? Simplify<
              Omit<InferFullRow<TContract, ModelName>, DiscField> &
                InferFullRow<TContract, VK> &
                Record<DiscField, Value>
            >
          : never;
      }[keyof V & string]
    : InferFullRow<TContract, ModelName>
  : InferFullRow<TContract, ModelName>;

export type InferRootRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = VariantRow<TContract, ModelName>;

export type DiscriminatorValues<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly variants: infer V extends Record<string, unknown>;
}
  ? keyof V & string
  : never;

type VariantModelName<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  VariantValue extends string,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly variants: infer V extends Record<string, { readonly model: string }>;
}
  ? VariantValue extends keyof V
    ? V[VariantValue]['model']
    : never
  : never;

export type VariantSelectable<TVariantValue extends string> = [TVariantValue] extends [never]
  ? unknown
  : {
      readonly 'variant() needs a collection with no variant selected; call it on the base collection': never;
    };

export type VariantModelRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  VariantValue extends string,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly discriminator: { readonly field: infer DiscField extends string };
  readonly variants: infer V extends Record<string, { readonly model: string }>;
}
  ? VariantValue extends keyof V
    ? V[VariantValue]['model'] extends infer VK extends string & keyof MongoModelsMap<TContract>
      ? Simplify<
          Omit<InferFullRow<TContract, ModelName>, DiscField> &
            InferFullRow<TContract, VK> &
            Record<DiscField, VariantValue>
        >
      : InferFullRow<TContract, ModelName>
    : InferFullRow<TContract, ModelName>
  : InferFullRow<TContract, ModelName>;

type IncludeRelationRowType<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  RelKey extends keyof ModelRelations<TContract, ModelName>,
> = ModelRelations<TContract, ModelName>[RelKey] extends ContractReferenceRelation
  ? ModelRelations<TContract, ModelName>[RelKey] extends infer R
    ? R extends { readonly cardinality: infer C }
      ? RelationTargetModel<TContract, R> extends infer To extends string &
          keyof MongoModelsMap<TContract>
        ? C extends 'N:1' | '1:1'
          ? R extends { readonly nullable: false }
            ? InferFullRow<TContract, To>
            : InferFullRow<TContract, To> | null
          : InferFullRow<TContract, To>[]
        : never
      : never
    : never
  : never;

export type IncludeResultFields<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TInclude extends MongoIncludeSpec<TContract, ModelName>,
> = {
  -readonly [K in keyof TInclude & string as TInclude[K] extends true
    ? K
    : never]: K extends keyof ModelRelations<TContract, ModelName>
    ? IncludeRelationRowType<TContract, ModelName, K>
    : never;
};

export type MongoWhereFilter<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TCodecTypes extends Record<string, { output: unknown }> = ExtractMongoCodecTypes<TContract>,
> = {
  readonly [K in keyof MongoModelsMap<TContract>[ModelName]['fields']]?: MongoModelsMap<TContract>[ModelName]['fields'][K] extends {
    readonly type: {
      readonly kind: 'scalar';
      readonly codecId: infer CId extends string & keyof TCodecTypes;
    };
  }
    ? WhereScalarValue<
        MongoModelsMap<TContract>[ModelName]['fields'][K],
        TCodecTypes[CId]['output']
      >
    : unknown;
};

type WhereScalarValue<Field, Element> =
  | (Field extends { readonly many: { readonly elementNullable: infer ElementNullable } }
      ? Element | readonly (ElementNullable extends true ? Element | null : Element)[]
      : Element)
  | (Field extends { readonly nullable: true } ? null : never);

export type MongoIncludeSpec<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  readonly [K in ReferenceRelationKeys<TContract, ModelName>]?: true;
};

export type NoIncludes = Pick<Record<string, boolean>, never>;

export type IncludedRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TIncludes extends MongoIncludeSpec<TContract, ModelName> = NoIncludes,
> = InferRootRow<TContract, ModelName> & IncludeResultFields<TContract, ModelName, TIncludes>;

export type DefaultModelRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = ResolvedOutputRow<TContract, ModelName>;

/**
 * An input with no keys is `Record<string, never>`, not `{}`: TypeScript accepts any object where `{}` is expected, so a model with no fields would accept any key.
 */
type ClosedWhenEmpty<T> = [keyof T] extends [never] ? Record<string, never> : T;

/** The fields an update of the model takes. For a model with no fields, it rejects every key. */
export type UpdateInput<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = ClosedWhenEmpty<Partial<DefaultModelRow<TContract, ModelName>>>;

type ModelCollectionName<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly storage: { readonly collection: infer Collection extends string };
}
  ? Collection
  : ModelName;

type ExecutionDefaultEntry<TContract extends MongoContract> =
  NonNullable<TContract['execution']> extends {
    readonly mutations: { readonly defaults: ReadonlyArray<infer Entry> };
  }
    ? Entry
    : never;

/**
 * Fields of the model's collection that an execution default fills on create; the create input makes them optional, mirroring `IsOptionalCreateField` in the SQL ORM client.
 */
type GeneratedOnCreateFields<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> =
  Extract<
    ExecutionDefaultEntry<TContract>,
    {
      readonly ref: { readonly entry: ModelCollectionName<TContract, ModelName> };
      readonly onCreate: unknown;
    }
  > extends infer Matched
    ? Matched extends { readonly ref: { readonly field: infer Field extends string } }
      ? OwnFieldStoredAs<TContract, ModelName, Field>
      : never
    : never;

/** The field stored as `_id`, which MongoDB fills when a create leaves it out. */
type DocumentIdField<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = OwnFieldStoredAs<TContract, ModelName, '_id'>;

/**
 * Fields a document may leave out: nullable ones, which read back as `null`. The create input makes them optional, as the SQL ORM client does for nullable columns.
 */
type NullableFields<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = {
  [K in keyof MongoModelsMap<TContract>[ModelName]['fields'] &
    string]: MongoModelsMap<TContract>[ModelName]['fields'][K] extends { readonly nullable: true }
    ? K
    : never;
}[keyof MongoModelsMap<TContract>[ModelName]['fields'] & string];

type OptionalOnCreate<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> =
  | DocumentIdField<TContract, ModelName>
  | GeneratedOnCreateFields<TContract, ModelName>
  | NullableFields<TContract, ModelName>;

export type CreateInput<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = Omit<ResolvedInputRow<TContract, ModelName>, OptionalOnCreate<TContract, ModelName>> &
  Partial<
    Pick<
      ResolvedInputRow<TContract, ModelName>,
      OptionalOnCreate<TContract, ModelName> & keyof ResolvedInputRow<TContract, ModelName>
    >
  >;

type VariantNullableFields<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  VariantValue extends string,
> = VariantValue extends string
  ? VariantModelName<TContract, ModelName, VariantValue> extends infer VK extends string &
      keyof MongoModelsMap<TContract>
    ? NullableFields<TContract, VK>
    : never
  : never;

type DiscriminatorField<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly discriminator: { readonly field: infer F extends string };
}
  ? F
  : never;

// TODO(TML-2229): VariantModelRow flows through ResolvedOutputRow, so variant
// domain fields use output types. Only the document id pick uses ResolvedInputRow.
// When input/output types diverge (parameterized codecs), this needs an
// input-side VariantModelRow.
export type VariantCreateInput<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  VariantValue extends string,
> = Omit<
  VariantModelRow<TContract, ModelName, VariantValue>,
  | OptionalOnCreate<TContract, ModelName>
  | VariantNullableFields<TContract, ModelName, VariantValue>
  | DiscriminatorField<TContract, ModelName>
> &
  Partial<
    Pick<
      ResolvedInputRow<TContract, ModelName>,
      DocumentIdField<TContract, ModelName> & keyof ResolvedInputRow<TContract, ModelName>
    >
  > &
  Partial<
    Pick<
      VariantModelRow<TContract, ModelName, VariantValue>,
      (
        | GeneratedOnCreateFields<TContract, ModelName>
        | NullableFields<TContract, ModelName>
        | VariantNullableFields<TContract, ModelName, VariantValue>
      ) &
        keyof VariantModelRow<TContract, ModelName, VariantValue>
    >
  >;

export type ResolvedCreateInput<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TVariantValue extends string,
> = [TVariantValue] extends [never]
  ? CreateInput<TContract, ModelName>
  : VariantCreateInput<TContract, ModelName, TVariantValue>;
