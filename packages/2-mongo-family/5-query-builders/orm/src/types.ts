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
  ? V extends Record<string, { readonly value: string }>
    ? {
        [VK in keyof V]: VK extends string & keyof MongoModelsMap<TContract>
          ? Simplify<
              Omit<InferFullRow<TContract, ModelName>, DiscField> &
                InferFullRow<TContract, VK> &
                Record<DiscField, V[VK]['value']>
            >
          : never;
      }[keyof V]
    : InferFullRow<TContract, ModelName>
  : InferFullRow<TContract, ModelName>;

export type InferRootRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = VariantRow<TContract, ModelName>;

export type VariantNames<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly variants: infer V extends Record<string, unknown>;
}
  ? keyof V & string
  : never;

export type VariantModelRow<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  VariantName extends string,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly discriminator: { readonly field: infer DiscField extends string };
  readonly variants: infer V;
}
  ? V extends Record<string, { readonly value: string }>
    ? VariantName extends keyof V & string & keyof MongoModelsMap<TContract>
      ? Simplify<
          Omit<InferFullRow<TContract, ModelName>, DiscField> &
            InferFullRow<TContract, VariantName> &
            Record<DiscField, V[VariantName]['value']>
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
    ? TCodecTypes[CId]['output']
    : unknown;
};

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

export type CreateInput<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = Omit<ResolvedInputRow<TContract, ModelName>, '_id'> &
  Partial<
    Pick<
      ResolvedInputRow<TContract, ModelName>,
      '_id' & keyof ResolvedInputRow<TContract, ModelName>
    >
  >;

type DiscriminatorField<
  TContract extends MongoContract,
  ModelName extends string & keyof MongoModelsMap<TContract>,
> = MongoModelsMap<TContract>[ModelName] extends {
  readonly discriminator: { readonly field: infer F extends string };
}
  ? F
  : never;

// TODO(TML-2229): VariantModelRow flows through ResolvedOutputRow, so variant
// domain fields use output types. Only the _id pick uses ResolvedInputRow.
// When input/output types diverge (parameterized codecs), this needs an
// input-side VariantModelRow.
export type VariantCreateInput<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  VariantName extends string,
> = Omit<
  VariantModelRow<TContract, ModelName, VariantName>,
  '_id' | DiscriminatorField<TContract, ModelName>
> &
  Partial<
    Pick<
      ResolvedInputRow<TContract, ModelName>,
      '_id' & keyof ResolvedInputRow<TContract, ModelName>
    >
  >;

export type ResolvedCreateInput<
  TContract extends MongoContractWithTypeMaps<MongoContract, AnyMongoTypeMaps>,
  ModelName extends string & keyof MongoModelsMap<TContract>,
  TVariant extends string,
> = [TVariant] extends [never]
  ? CreateInput<TContract, ModelName>
  : VariantCreateInput<TContract, ModelName, TVariant>;
