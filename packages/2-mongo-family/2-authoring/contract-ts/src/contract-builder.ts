import { computeProfileHash, computeStorageHash } from '@internal/contract/hashing';
import {
  type ContractEmbedRelation,
  type ContractEnum,
  type ContractField,
  type ContractFieldType,
  type ContractModelBase,
  type ContractReferenceRelation,
  type ContractValueObject,
  type ControlPolicy,
  type CrossReference,
  crossRef,
  type JsonValue,
  type ProfileHashBase,
  type StorageHashBase,
  type ValueSetRef,
} from '@internal/contract/types';
import {
  createEntityHelpersFromNamespace,
  type EntityHelpersFromNamespace,
  type ExtractAuthoringNamespaceFromPack,
  type MergeExtensionAuthoringNamespaces,
  resolveToOneRelationNullable,
} from '@internal/contract-authoring';
import { errorEnumCodecNotInPackStack } from '@internal/errors/control';
import type { AuthoringEntityTypeNamespace } from '@internal/framework-components/authoring';
import {
  assertNoCrossRegistryCollisions,
  mergeAuthoringNamespaces,
} from '@internal/framework-components/authoring';
import type { CodecLookup } from '@internal/framework-components/codec';
import type {
  ExtensionPackRef,
  FamilyPackRef,
  TargetPackRef,
} from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';
import { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import {
  applyPolymorphicScopeToMongoIndex,
  buildMongoNamespace,
  type MongoCollection,
  type MongoCollectionInput,
  MongoCollectionOptions,
  type MongoCollectionOptionsAuthoringInput,
  type MongoCollectionOptionsInput,
  type MongoContract,
  type MongoContractWithTypeMaps,
  MongoIndex,
  type MongoIndexAuthoringInput,
  type MongoIndexFields,
  type MongoIndexInput,
  type MongoIndexOptionsInput,
  MongoStorage,
  type MongoStorageShape,
  type MongoTypeMaps,
  type MongoValueSetInput,
} from '@internal/mongo-contract';
import { mongoContractCanonicalizationHooks } from '@internal/mongo-contract/canonicalization-hooks';
import { canonicalStringify } from '@internal/utils/canonical-stringify';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { contractError } from './contract-errors';
import type { EnumTypeHandle } from './enum-type';

/**
 * Encode an authored enum value to its codec-encoded JSON form, mirroring SQL's `build-contract`.
 *
 * The codec is resolved by id from the lookup built from the contract's target pack, so a
 * non-identity `encodeJson` (permitted by the `mongoCodec` factory) is respected. A codecId the
 * lookup cannot resolve is a hard error: the enum uses a codec that is not part of the contract's
 * pack stack.
 */
function encodeEnumValue(value: unknown, codecId: string, codecLookup: CodecLookup): JsonValue {
  const codec = codecLookup.get(codecId);
  if (!codec) {
    throw errorEnumCodecNotInPackStack({ codecId });
  }
  return codec.encodeJson(value);
}

// `canonicalStringify` rejects non-plain objects so a `Map` or class
// instance cannot silently collapse to `{}`. The storage-shape values
// produced by `toStorageIndex` post-M2-R2 are `MongoIndex` class
// instances (see ADR for the storage-map class flip / FR18), which
// trips that guard. This local helper produces the same key-sorted,
// JSON-like representation `canonicalStringify` produces for plain
// objects, but accepts class instances by reading their enumerable
// properties via `Object.entries`. The output is only used as an
// in-memory dedup signature for collection indexes; it never leaves
// the builder.
function stableStringify(value: unknown): string {
  if (Array.isArray(value)) {
    return `[${value.map(stableStringify).join(',')}]`;
  }

  if (value && typeof value === 'object') {
    return `{${Object.entries(value as Record<string, unknown>)
      .sort(([left], [right]) => left.localeCompare(right))
      .map(([key, entry]) => `${JSON.stringify(key)}:${stableStringify(entry)}`)
      .join(',')}}`;
  }

  return JSON.stringify(value);
}

type VariantSpec = {
  readonly value: string;
};

type StorageRelationSpec = {
  readonly field: string;
};

type StringListInput = string | readonly string[];
type Present<T> = Exclude<T, undefined>;
type EmptyObject = Record<never, never>;
type Simplify<T> = { [K in keyof T]: T[K] } & EmptyObject;
type StrictShape<Actual, Shape> = Actual &
  Shape &
  Record<Exclude<keyof Actual, keyof Shape>, never>;

type UnionToIntersection<Union> = (Union extends unknown ? (value: Union) => void : never) extends (
  value: infer Intersection,
) => void
  ? Intersection
  : never;

export type ExtractCodecTypesFromPack<P> = P extends { __codecTypes?: infer CodecTypes }
  ? CodecTypes extends Record<string, { output: unknown }>
    ? CodecTypes
    : Record<string, never>
  : Record<string, never>;

// This mirrors @internal/target-mongo/codec-types because authoring must stay decoupled from
// the target layer while still exposing the built-in Mongo codec registry to type inference.
type MongoCodecTypes = {
  readonly 'mongo/objectId@1': { readonly input: string; readonly output: string };
  readonly 'mongo/string@1': { readonly input: string; readonly output: string };
  readonly 'mongo/double@1': { readonly input: number; readonly output: number };
  readonly 'mongo/int32@1': { readonly input: number; readonly output: number };
  readonly 'mongo/bool@1': { readonly input: boolean; readonly output: boolean };
  readonly 'mongo/date@1': { readonly input: Date; readonly output: Date };
  readonly 'mongo/vector@1': {
    readonly input: readonly number[];
    readonly output: readonly number[];
  };
};

type MergeExtensionCodecTypes<Packs extends Record<string, unknown>> = UnionToIntersection<
  {
    [K in keyof Packs]: ExtractCodecTypesFromPack<Packs[K]>;
  }[keyof Packs]
>;

type MergeExtensionCodecTypesSafe<Packs> =
  Packs extends Record<string, unknown>
    ? keyof Packs extends never
      ? Record<string, never>
      : MergeExtensionCodecTypes<Packs>
    : Record<string, never>;

export interface FieldBuilder<
  Type extends ContractFieldType = ContractFieldType,
  Nullable extends boolean = boolean,
  Many extends boolean = boolean,
  Handle extends EnumTypeHandle | undefined = EnumTypeHandle | undefined,
> {
  readonly __kind: 'field';
  readonly __type: Type;
  readonly __nullable: Nullable;
  readonly __many: Many;
  readonly __enumHandle: Handle;
  optional(): FieldBuilder<Type, true, Many, Handle>;
  many(): FieldBuilder<Type, Nullable, true, Handle>;
}

export interface ValueObjectBuilder<
  Name extends string = string,
  Fields extends Record<string, FieldBuilder> = Record<string, FieldBuilder>,
> {
  readonly __kind: 'valueObject';
  readonly __name: Name;
  readonly __fields: Fields;
}

export interface FieldReference<
  ModelName extends string = string,
  FieldName extends string = string,
> {
  readonly __kind: 'fieldRef';
  readonly modelName: ModelName;
  readonly fieldName: FieldName;
}

export interface RelationOn<
  LocalFields extends readonly string[] = readonly string[],
  TargetFields extends readonly string[] = readonly string[],
> {
  readonly localFields: LocalFields;
  readonly targetFields: TargetFields;
}

export interface RelationBuilder<
  To extends string = string,
  Cardinality extends '1:1' | '1:N' | 'N:1' = '1:1' | '1:N' | 'N:1',
  On extends RelationOn | undefined = RelationOn | undefined,
  Nullable extends boolean | undefined = boolean | undefined,
> {
  readonly __kind: 'relation';
  readonly __to: To;
  readonly __cardinality: Cardinality;
  readonly __on: On;
  /**
   * The authored `optional` flag of a `belongsTo`; `undefined` when the author
   * gave none. Always `true` for a `hasOne` reference: the side without the
   * foreign key has nothing guaranteeing the related document exists.
   */
  readonly __nullable: Nullable;
}

export interface ModelBuilder<
  Name extends string = string,
  Fields extends Record<string, FieldBuilder> = Record<string, FieldBuilder>,
  Relations extends Record<string, RelationBuilder> = Record<string, RelationBuilder>,
  Collection extends string | undefined = string | undefined,
  Owner extends string | undefined = string | undefined,
  Base extends string | undefined = string | undefined,
  StorageRelations extends Record<string, StorageRelationSpec> | undefined =
    | Record<string, StorageRelationSpec>
    | undefined,
  Discriminator extends { readonly field: string } | undefined =
    | { readonly field: string }
    | undefined,
  Variants extends Record<string, VariantSpec> | undefined =
    | Record<string, VariantSpec>
    | undefined,
> {
  readonly __kind: 'model';
  readonly __name: Name;
  readonly __fields: Fields;
  readonly __relations: Relations;
  readonly __indexes: readonly MongoIndexAuthoringInput[] | undefined;
  readonly __collectionOptions: MongoCollectionOptionsAuthoringInput | undefined;
  readonly __controlPolicy: ControlPolicy | undefined;
  readonly __collection: Collection;
  readonly __owner: Owner;
  readonly __base: Base;
  readonly __storageRelations: StorageRelations;
  readonly __discriminator: Discriminator;
  readonly __variants: Variants;
  ref<const FieldName extends keyof Fields & string>(
    fieldName: FieldName,
  ): FieldReference<Name, FieldName>;
}

type AnyFieldBuilder = FieldBuilder<
  ContractFieldType,
  boolean,
  boolean,
  EnumTypeHandle | undefined
>;
type AnyReferenceRelationBuilder = RelationBuilder<string, '1:1' | '1:N' | 'N:1', RelationOn>;
type AnyEmbedRelationBuilder = RelationBuilder<string, '1:1' | '1:N', undefined>;
type AnyRelationBuilder = AnyReferenceRelationBuilder | AnyEmbedRelationBuilder;
type AnyFieldReference = FieldReference<string, string>;
type NamedValueObjectBuilder<
  Name extends string = string,
  Fields extends Record<string, AnyFieldBuilder> = Record<string, AnyFieldBuilder>,
> = ValueObjectBuilder<Name, Fields>;
type AnyValueObjectBuilder = NamedValueObjectBuilder;
type NamedModelBuilder<
  Name extends string = string,
  Fields extends Record<string, AnyFieldBuilder> = Record<string, AnyFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> = Record<string, AnyRelationBuilder>,
  Collection extends string | undefined = string | undefined,
  Owner extends string | undefined = string | undefined,
  Base extends string | undefined = string | undefined,
  StorageRelations extends Record<string, StorageRelationSpec> | undefined =
    | Record<string, StorageRelationSpec>
    | undefined,
  Discriminator extends { readonly field: string } | undefined =
    | { readonly field: string }
    | undefined,
  Variants extends Record<string, VariantSpec> | undefined =
    | Record<string, VariantSpec>
    | undefined,
> = ModelBuilder<
  Name,
  Fields,
  Relations,
  Collection,
  Owner,
  Base,
  StorageRelations,
  Discriminator,
  Variants
>;
type AnyModelBuilder = NamedModelBuilder;

type ExtractFieldReferenceName<T> =
  T extends FieldReference<string, infer FieldName extends string> ? FieldName : never;
type ExtractModelName<T> = T extends NamedModelBuilder<infer Name> ? Name : never;
type ExtractValueObjectName<T> = T extends NamedValueObjectBuilder<infer Name> ? Name : never;
type ExtractModelCollection<T> =
  T extends NamedModelBuilder<
    string,
    Record<string, AnyFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    infer Collection
  >
    ? Collection
    : never;
type ExtractModelOwner<T> =
  T extends NamedModelBuilder<
    string,
    Record<string, AnyFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    string | undefined,
    infer Owner
  >
    ? Owner
    : never;
type ExtractModelBase<T> =
  T extends NamedModelBuilder<
    string,
    Record<string, AnyFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    string | undefined,
    string | undefined,
    infer Base
  >
    ? Base
    : never;
type ExtractModelStorageRelations<T> =
  T extends NamedModelBuilder<
    string,
    Record<string, AnyFieldBuilder>,
    Record<string, AnyRelationBuilder>,
    string | undefined,
    string | undefined,
    string | undefined,
    infer StorageRelations
  >
    ? StorageRelations
    : never;

type ModelStorageSection<T> =
  ExtractModelCollection<T> extends string
    ? { readonly collection: ExtractModelCollection<T> }
    : EmptyObject;
type ModelStorageRelationsSection<T> =
  ExtractModelStorageRelations<T> extends Record<string, StorageRelationSpec>
    ? keyof ExtractModelStorageRelations<T> extends never
      ? EmptyObject
      : { readonly relations: ExtractModelStorageRelations<T> }
    : EmptyObject;
type RootModelCollection<T> =
  ExtractModelCollection<T> extends string
    ? ExtractModelOwner<T> extends undefined
      ? ExtractModelBase<T> extends undefined
        ? ExtractModelCollection<T>
        : never
      : never
    : never;
type RootModelName<T> = RootModelCollection<T> extends never ? never : ExtractModelName<T>;
type CollectionName<T> =
  ExtractModelCollection<T> extends string ? ExtractModelCollection<T> : never;

type ModelNameInput = string | AnyModelBuilder;
type ValueObjectNameInput = string | AnyValueObjectBuilder;
type RelationTargetFieldsInput<TargetName extends string> =
  | StringListInput
  | FieldReference<TargetName, string>
  | readonly FieldReference<TargetName, string>[];

type NormalizeModelName<T> = T extends string ? T : ExtractModelName<T>;

type NormalizeModelNameOrUndefined<T> = [T] extends [undefined]
  ? undefined
  : NormalizeModelName<Present<T>>;

type NormalizeValueObjectName<T> = T extends string ? T : ExtractValueObjectName<T>;

type NormalizeStringList<T> = T extends readonly string[]
  ? T
  : T extends string
    ? readonly [T]
    : readonly string[];

type NormalizeTargetFieldList<T> = T extends readonly AnyFieldReference[]
  ? {
      readonly [K in keyof T]: ExtractFieldReferenceName<T[K]>;
    }
  : T extends AnyFieldReference
    ? readonly [ExtractFieldReferenceName<T>]
    : NormalizeStringList<T>;

type ContractFieldFromBuilder<TBuilder> =
  TBuilder extends FieldBuilder<
    infer Type extends ContractFieldType,
    infer Nullable extends boolean,
    infer Many extends boolean
  >
    ? Simplify<
        {
          readonly type: Type;
          readonly nullable: Nullable;
        } & (Many extends true ? { readonly many: true } : EmptyObject)
      >
    : never;

type ContractFieldsFromRecord<Fields extends Record<string, AnyFieldBuilder>> = Simplify<{
  readonly [K in keyof Fields]: ContractFieldFromBuilder<Fields[K]>;
}>;

type ContractValueObjectFromBuilder<TBuilder> =
  TBuilder extends ValueObjectBuilder<string, infer Fields extends Record<string, AnyFieldBuilder>>
    ? Simplify<{
        readonly fields: ContractFieldsFromRecord<Fields>;
      }>
    : never;

type ContractValueObjectsFromRecord<ValueObjects extends Record<string, AnyValueObjectBuilder>> =
  Simplify<{
    readonly [K in keyof ValueObjects as ExtractValueObjectName<
      ValueObjects[K]
    >]: ContractValueObjectFromBuilder<ValueObjects[K]>;
  }>;

type AnyFieldNullable<
  Fields extends Record<string, AnyFieldBuilder>,
  FieldNames extends readonly string[],
> = FieldNames[number] extends infer Name
  ? Name extends keyof Fields
    ? Fields[Name] extends FieldBuilder<ContractFieldType, true, boolean>
      ? true
      : never
    : never
  : never;

type ToOneRelationNullable<
  Fields extends Record<string, AnyFieldBuilder>,
  Cardinality extends '1:1' | 'N:1',
  On extends RelationOn,
  Nullable extends boolean | undefined,
> = Nullable extends boolean
  ? Nullable
  : Cardinality extends '1:1'
    ? true
    : [AnyFieldNullable<Fields, On['localFields']>] extends [never]
      ? false
      : true;

type ContractRelationFromBuilder<TBuilder, Fields extends Record<string, AnyFieldBuilder>> =
  TBuilder extends RelationBuilder<
    infer To extends string,
    infer Cardinality extends '1:1' | '1:N' | 'N:1',
    infer On extends RelationOn | undefined,
    infer Nullable extends boolean | undefined
  >
    ? On extends RelationOn
      ? Cardinality extends '1:1' | 'N:1'
        ? {
            readonly to: CrossRefFor<To>;
            readonly cardinality: Cardinality;
            readonly nullable: ToOneRelationNullable<Fields, Cardinality, On, Nullable>;
            readonly on: On;
          }
        : {
            readonly to: CrossRefFor<To>;
            readonly cardinality: Cardinality;
            readonly on: On;
          }
      : {
          readonly to: CrossRefFor<To>;
          readonly cardinality: Cardinality;
        }
    : never;

type ContractRelationsFromRecord<
  Relations extends Record<string, AnyRelationBuilder>,
  Fields extends Record<string, AnyFieldBuilder>,
> = keyof Relations extends never
  ? Record<string, never>
  : Simplify<{
      readonly [K in keyof Relations]: ContractRelationFromBuilder<Relations[K], Fields>;
    }>;

type ContractModelStorageFromBuilder<TBuilder> = ModelStorageSection<TBuilder> &
  ModelStorageRelationsSection<TBuilder>;

type MaybeOwner<Owner> = [Owner] extends [undefined]
  ? EmptyObject
  : { readonly owner: Owner & string };
type MaybeBase<Base> = [Base] extends [undefined]
  ? EmptyObject
  : { readonly base: CrossRefFor<Base & string> };
type MaybeDiscriminator<Discriminator> = [Discriminator] extends [undefined]
  ? EmptyObject
  : { readonly discriminator: Discriminator & { readonly field: string } };
type MaybeVariants<Variants> = [Variants] extends [undefined]
  ? EmptyObject
  : { readonly variants: Variants };

type ContractModelFromBuilder<TBuilder> =
  TBuilder extends NamedModelBuilder<
    string,
    infer Fields extends Record<string, AnyFieldBuilder>,
    infer Relations extends Record<string, AnyRelationBuilder>,
    string | undefined,
    infer Owner,
    infer Base,
    Record<string, StorageRelationSpec> | undefined,
    infer Discriminator,
    infer Variants
  >
    ? Simplify<
        {
          readonly fields: ContractFieldsFromRecord<Fields>;
          readonly relations: ContractRelationsFromRecord<Relations, Fields>;
          readonly storage: ContractModelStorageFromBuilder<TBuilder>;
        } & MaybeOwner<Owner> &
          MaybeBase<Base> &
          MaybeDiscriminator<Discriminator> &
          MaybeVariants<Variants>
      >
    : never;

type ContractModelsFromRecord<Models extends Record<string, AnyModelBuilder>> = Simplify<{
  readonly [K in keyof Models as ExtractModelName<Models[K]>]: ContractModelFromBuilder<Models[K]>;
}>;

type CrossRefFor<M extends string> = CrossReference & { readonly model: M };

type DerivedRootModels<Models extends Record<string, AnyModelBuilder>> = Simplify<{
  readonly [K in keyof Models as RootModelCollection<Models[K]>]: CrossRefFor<
    RootModelName<Models[K]>
  >;
}>;

type StorageCollectionsFromModels<Models extends Record<string, AnyModelBuilder>> = Simplify<{
  readonly [K in keyof Models as CollectionName<Models[K]>]: MongoCollection;
}>;

type NormalizeRoots<Roots extends Record<string, ModelNameInput>> = Simplify<{
  readonly [K in keyof Roots]: CrossRefFor<NormalizeModelName<Roots[K]>>;
}>;

type DefinitionModels<Definition> = Definition extends {
  readonly models?: infer Models extends Record<string, AnyModelBuilder>;
}
  ? Models
  : Record<never, never>;

type DefinitionValueObjects<Definition> = Definition extends {
  readonly valueObjects?: infer ValueObjects extends Record<string, AnyValueObjectBuilder>;
}
  ? ValueObjects
  : Record<never, never>;

type DefinitionEnums<Definition> = Definition extends {
  readonly enums?: infer E;
}
  ? Present<E> extends Record<string, EnumTypeHandle>
    ? string extends keyof Present<E>
      ? Record<never, never>
      : Present<E>
    : Record<never, never>
  : Record<never, never>;

type EnumHandleAccessorType<Handle> =
  Handle extends EnumTypeHandle<infer _Name, infer Values, infer Names, infer MembersMap>
    ? {
        readonly values: Values;
        readonly names: Names;
        readonly members: MembersMap;
        has(v: Values[number]): boolean;
        nameOf(v: Values[number]): string | undefined;
        ordinalOf(v: Values[number]): number;
      }
    : never;

type BuiltEnumAccessors<Definition> = {
  readonly [K in keyof DefinitionEnums<Definition>]: EnumHandleAccessorType<
    DefinitionEnums<Definition>[K]
  >;
};

type DefinitionRoots<Definition> = Definition extends {
  readonly roots?: infer Roots extends Record<string, ModelNameInput>;
}
  ? NormalizeRoots<Roots>
  : DerivedRootModels<DefinitionModels<Definition>>;

type DefinitionExtensions<Definition> = Definition extends {
  readonly extensions?: infer Extensions extends Record<string, ExtensionPackRef<string, string>>;
}
  ? Extensions
  : Record<never, never>;

type DefinitionFamilyId<Definition> = Definition extends {
  readonly family: FamilyPackRef<infer FamilyId>;
}
  ? FamilyId
  : string;

type DefinitionTargetId<Definition> = Definition extends {
  readonly target: TargetPackRef<string, infer TargetId>;
}
  ? TargetId
  : string;

type DefinitionStorage<Definition> = Simplify<
  MongoStorageShape & {
    readonly collections: StorageCollectionsFromModels<DefinitionModels<Definition>>;
    readonly storageHash: StorageHashBase<string>;
  }
>;

type MaybeValueObjectsSection<ValueObjects extends Record<string, AnyValueObjectBuilder>> =
  keyof ValueObjects extends never
    ? EmptyObject
    : {
        readonly valueObjects: ContractValueObjectsFromRecord<ValueObjects>;
      };

// Project EnumTypeHandle to the namespace enum-entry shape.
// Uses enumMembers (which carries Values[number] literals) rather than
// ContractEnum.members (which uses JsonValue and erases literals).
type EnumHandleToEntry<Handle> =
  Handle extends EnumTypeHandle<string, infer Values, infer _Names, infer _MembersMap>
    ? {
        readonly codecId: string;
        readonly members: readonly { readonly name: string; readonly value: Values[number] }[];
      }
    : never;

type ContractEnumsFromRecord<Enums extends Record<string, EnumTypeHandle>> = {
  readonly [K in keyof Enums as Enums[K] extends EnumTypeHandle<infer Name>
    ? Name
    : never]: EnumHandleToEntry<Enums[K]>;
};

type MaybeEnumsSection<Enums extends Record<string, EnumTypeHandle>> = keyof Enums extends never
  ? EmptyObject
  : {
      readonly enum: ContractEnumsFromRecord<Enums>;
    };

type MongoDomainNamespaceFromDefinition<Definition> = Simplify<
  {
    readonly models: ContractModelsFromRecord<DefinitionModels<Definition>>;
  } & MaybeValueObjectsSection<DefinitionValueObjects<Definition>> &
    MaybeEnumsSection<DefinitionEnums<Definition>>
>;

type MongoContractBaseFromDefinition<Definition> = Simplify<{
  readonly target: DefinitionTargetId<Definition>;
  readonly targetFamily: DefinitionFamilyId<Definition>;
  readonly roots: DefinitionRoots<Definition>;
  readonly domain: {
    readonly namespaces: {
      readonly [K in typeof UNBOUND_NAMESPACE_ID]: MongoDomainNamespaceFromDefinition<Definition>;
    };
  };
  readonly storage: DefinitionStorage<Definition>;
  readonly capabilities: Record<string, never>;
  readonly extensions: DefinitionExtensions<Definition>;
  readonly profileHash: ProfileHashBase<string>;
  readonly meta: Record<string, never>;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly enumAccessors?: BuiltEnumAccessors<Definition>;
}>;

type CodecTypesFromDefinition<Definition> = MongoCodecTypes &
  MergeExtensionCodecTypesSafe<DefinitionExtensions<Definition>>;

// The enum value union for a field builder — `EnumTypeHandle['values'][number]`
// when the builder carries an enum handle, `never` otherwise.
type BuilderEnumValueUnion<TBuilder> =
  TBuilder extends FieldBuilder<
    ContractFieldType,
    boolean,
    boolean,
    infer Handle extends EnumTypeHandle | undefined
  >
    ? [Handle] extends [EnumTypeHandle<string, infer Values>]
      ? readonly unknown[] extends Values
        ? never
        : Values[number]
      : never
    : never;

// The base codec/enum/value-object type for a builder field on a given channel,
// before nullable/many modifiers. Enum fields resolve to the value union on both
// channels; scalar fields resolve to the codec's channel-specific type.
type BuilderBaseChannelType<
  TBuilder,
  TValueObjects extends Record<string, AnyValueObjectBuilder>,
  TCodecTypes extends Record<string, { output: unknown; input: unknown }>,
  Channel extends 'output' | 'input',
> =
  TBuilder extends FieldBuilder<
    infer Type extends ContractFieldType,
    boolean,
    boolean,
    EnumTypeHandle | undefined
  >
    ? [BuilderEnumValueUnion<TBuilder>] extends [never]
      ? Type extends {
          readonly kind: 'scalar';
          readonly codecId: infer CId extends keyof TCodecTypes;
        }
        ? TCodecTypes[CId][Channel]
        : Type extends { readonly kind: 'valueObject'; readonly name: infer VOName extends string }
          ? VOName extends keyof TValueObjects
            ? {
                -readonly [K in keyof ExtractValueObjectFields<
                  TValueObjects[VOName]
                >]: BuilderFieldChannelType<
                  ExtractValueObjectFields<TValueObjects[VOName]>[K],
                  TValueObjects,
                  TCodecTypes,
                  Channel
                >;
              }
            : unknown
          : unknown
      : BuilderEnumValueUnion<TBuilder>
    : never;

type ExtractValueObjectFields<TBuilder> =
  TBuilder extends NamedValueObjectBuilder<string, infer Fields> ? Fields : Record<never, never>;

// Runs once per `defineContract` call to build the precomputed `FieldOutputTypes`/`FieldInputTypes`
// maps. Consumers index those maps in O(1) via `InferModelRow` — this is NOT re-evaluated per query.
// Recursion is bounded to value-object nesting depth (each level resolves its fields exactly once).
//
// The JS type for one field builder on a given channel, with nullable/many applied.
// Compose many first (array wrapping), then add nullability. This avoids the
// TypeScript operator-precedence trap where `A | B extends infer X` infers X
// only from B, not from `A | B`.
type BuilderFieldChannelType<
  TBuilder,
  TValueObjects extends Record<string, AnyValueObjectBuilder>,
  TCodecTypes extends Record<string, { output: unknown; input: unknown }>,
  Channel extends 'output' | 'input',
> =
  TBuilder extends FieldBuilder<
    ContractFieldType,
    infer Nullable extends boolean,
    infer Many extends boolean,
    EnumTypeHandle | undefined
  >
    ?
        | (Many extends true
            ? BuilderBaseChannelType<TBuilder, TValueObjects, TCodecTypes, Channel>[]
            : BuilderBaseChannelType<TBuilder, TValueObjects, TCodecTypes, Channel>)
        | (Nullable extends true ? null : never)
    : never;

type ExtractModelFields<TBuilder> =
  TBuilder extends NamedModelBuilder<string, infer Fields> ? Fields : Record<never, never>;

type FieldChannelTypesFromDefinition<Definition, Channel extends 'output' | 'input'> = {
  readonly [K in typeof UNBOUND_NAMESPACE_ID]: {
    readonly [ModelKey in keyof DefinitionModels<Definition> as ExtractModelName<
      DefinitionModels<Definition>[ModelKey]
    >]: {
      readonly [FieldName in keyof ExtractModelFields<
        DefinitionModels<Definition>[ModelKey]
      >]: BuilderFieldChannelType<
        ExtractModelFields<DefinitionModels<Definition>[ModelKey]>[FieldName],
        DefinitionValueObjects<Definition>,
        CodecTypesFromDefinition<Definition>,
        Channel
      >;
    };
  };
};

type FieldOutputTypesFromDefinition<Definition> = FieldChannelTypesFromDefinition<
  Definition,
  'output'
>;

type FieldInputTypesFromDefinition<Definition> = FieldChannelTypesFromDefinition<
  Definition,
  'input'
>;

export type MongoContractResult<Definition> = MongoContractWithTypeMaps<
  MongoContractBaseFromDefinition<Definition>,
  MongoTypeMaps<
    CodecTypesFromDefinition<Definition>,
    FieldOutputTypesFromDefinition<Definition>,
    FieldInputTypesFromDefinition<Definition>
  >
>;

type ExtractEntitiesNamespaceFromPack<Pack> = ExtractAuthoringNamespaceFromPack<
  Pack,
  'entityTypes',
  Record<never, never>
>;

type MergeExtensionEntityNamespaces<Extensions> = MergeExtensionAuthoringNamespaces<
  Extensions,
  'entityTypes'
>;

export type ContractAuthoringHelpers<
  Family extends FamilyPackRef<string> = FamilyPackRef<string>,
  Target extends TargetPackRef<string, string> = TargetPackRef<string, string>,
  Extensions extends Record<string, ExtensionPackRef<string, string>> | undefined = undefined,
> = EntityHelpersFromNamespace<
  ExtractEntitiesNamespaceFromPack<Family> &
    ExtractEntitiesNamespaceFromPack<Target> &
    MergeExtensionEntityNamespaces<Extensions>
> & {
  readonly field: typeof field;
  readonly index: typeof index;
  readonly model: typeof model;
  readonly rel: typeof rel;
  readonly valueObject: typeof valueObject;
};

type AuthoringComponent = {
  readonly authoring?: { readonly entityTypes?: unknown };
};

function extractEntitiesNamespace(component: AuthoringComponent): AuthoringEntityTypeNamespace {
  return (component.authoring?.entityTypes ?? {}) as AuthoringEntityTypeNamespace;
}

const MONGO_RESERVED_HELPER_KEYS: readonly string[] = [
  'field',
  'index',
  'model',
  'rel',
  'valueObject',
];

function composeMongoEntityHelpers(
  family: FamilyPackRef<string>,
  target: TargetPackRef<string, string>,
  extensions: Record<string, ExtensionPackRef<string, string>> | undefined,
): Record<string, unknown> {
  const components: readonly AuthoringComponent[] = [
    family,
    target,
    ...Object.values(extensions ?? {}),
  ];
  const merged: Record<string, unknown> = {};
  for (const component of components) {
    const ns = extractEntitiesNamespace(component);
    if (Object.keys(ns).length > 0) {
      mergeAuthoringNamespaces(merged, ns, [], 'entity', 'entity');
    }
  }
  // Mongo authoring does not yet ship contributed field / type namespaces in
  // the TS DSL surface, but the cross-registry guard mirrors SQL's call so
  // any future field / type contributions surface a structurally identical
  // collision error.
  assertNoCrossRegistryCollisions({}, {}, merged as AuthoringEntityTypeNamespace);
  // Pack-contributed entity types flatten onto the same top-level shape
  // as the built-in helpers (`model`, `rel`, `field`, `index`,
  // `valueObject`). Detect collisions explicitly so a contributed name
  // can't silently overwrite a built-in at runtime.
  const collisions = Object.keys(merged).filter((name) =>
    MONGO_RESERVED_HELPER_KEYS.includes(name),
  );
  if (collisions.length > 0) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Pack-contributed entity type(s) ${collisions.map((c) => `"${c}"`).join(', ')} collide with the reserved built-in helper key(s) on the Mongo composed helpers surface. Reserved keys: ${MONGO_RESERVED_HELPER_KEYS.map((k) => `"${k}"`).join(', ')}.`,
      { meta: { reason: 'reserved-helper-key-collision', contribution: collisions } },
    );
  }
  return createEntityHelpersFromNamespace(merged as AuthoringEntityTypeNamespace, {
    ctx: { family: family.familyId, target: target.targetId },
  });
}

export type ContractScaffold<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<string, string>,
  Extensions extends Record<string, ExtensionPackRef<string, string>> | undefined = undefined,
  Roots extends Record<string, ModelNameInput> | undefined = undefined,
> = {
  readonly family: Family;
  readonly target: Target;
  readonly extensions?: Extensions;
  readonly roots?: Roots;
  readonly defaultControlPolicy?: ControlPolicy;
};

export type ContractDefinition<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<string, string>,
  Models extends Record<string, AnyModelBuilder> = Record<never, never>,
  ValueObjects extends Record<string, AnyValueObjectBuilder> = Record<never, never>,
  Extensions extends Record<string, ExtensionPackRef<string, string>> | undefined = undefined,
  Roots extends Record<string, ModelNameInput> | undefined = undefined,
> = ContractScaffold<Family, Target, Extensions, Roots> & {
  readonly models?: Models;
  readonly valueObjects?: ValueObjects;
  readonly enums?: Record<string, EnumTypeHandle>;
};

export type ContractFactory<
  Models extends Record<string, AnyModelBuilder> = Record<never, never>,
  ValueObjects extends Record<string, AnyValueObjectBuilder> = Record<never, never>,
  Roots extends Record<string, ModelNameInput> | undefined = undefined,
  Family extends FamilyPackRef<string> = FamilyPackRef<string>,
  Target extends TargetPackRef<string, string> = TargetPackRef<string, string>,
  Extensions extends Record<string, ExtensionPackRef<string, string>> | undefined = undefined,
> = (helpers: ContractAuthoringHelpers<Family, Target, Extensions>) => {
  readonly models?: Models;
  readonly valueObjects?: ValueObjects;
  readonly roots?: Roots;
};

type FieldBuilderSpec<
  Type extends ContractFieldType,
  Nullable extends boolean,
  Many extends boolean,
> = {
  readonly type: Type;
  readonly nullable: Nullable;
  readonly many: Many;
};

function createFieldBuilder<
  Type extends ContractFieldType,
  Nullable extends boolean,
  Many extends boolean,
  Handle extends EnumTypeHandle | undefined = undefined,
>(
  spec: FieldBuilderSpec<Type, Nullable, Many>,
  enumHandle?: Handle,
): FieldBuilder<Type, Nullable, Many, Handle> {
  return {
    __kind: 'field',
    __type: spec.type,
    __nullable: spec.nullable,
    __many: spec.many,
    __enumHandle: blindCast<
      Handle,
      'optional param widens to Handle | undefined; Handle defaults to undefined when no enum handle is passed'
    >(enumHandle),
    optional() {
      return createFieldBuilder<Type, true, Many, Handle>(
        { type: spec.type, nullable: true, many: spec.many },
        enumHandle,
      );
    },
    many() {
      return createFieldBuilder<Type, Nullable, true, Handle>(
        { type: spec.type, nullable: spec.nullable, many: true },
        enumHandle,
      );
    },
  };
}

function normalizeOptionalTypeParams(
  typeParams: Record<string, unknown> | undefined,
): { readonly typeParams: Record<string, unknown> } | Record<never, never> {
  if (!typeParams) {
    return {};
  }

  return { typeParams };
}

function createScalarFieldBuilder<
  CodecId extends string,
  TypeParams extends Record<string, unknown> | undefined = undefined,
>(
  codecId: CodecId,
  options?: { readonly typeParams?: TypeParams },
): FieldBuilder<
  {
    readonly kind: 'scalar';
    readonly codecId: CodecId;
  } & ([TypeParams] extends [undefined] ? EmptyObject : { readonly typeParams: TypeParams }),
  false,
  false
> {
  return createFieldBuilder({
    type: {
      kind: 'scalar',
      codecId,
      ...normalizeOptionalTypeParams(options?.typeParams),
    } as {
      readonly kind: 'scalar';
      readonly codecId: CodecId;
    } & ([TypeParams] extends [undefined] ? EmptyObject : { readonly typeParams: TypeParams }),
    nullable: false,
    many: false,
  });
}

export const field = {
  scalar: createScalarFieldBuilder,
  objectId() {
    return createScalarFieldBuilder('mongo/objectId@1');
  },
  string() {
    return createScalarFieldBuilder('mongo/string@1');
  },
  double() {
    return createScalarFieldBuilder('mongo/double@1');
  },
  int32() {
    return createScalarFieldBuilder('mongo/int32@1');
  },
  bool() {
    return createScalarFieldBuilder('mongo/bool@1');
  },
  date() {
    return createScalarFieldBuilder('mongo/date@1');
  },
  vector<const TypeParams extends Record<string, unknown> | undefined = undefined>(options?: {
    readonly typeParams?: TypeParams;
  }) {
    return createScalarFieldBuilder('mongo/vector@1', options);
  },
  valueObject<const ValueObject extends ValueObjectNameInput>(valueObjectName: ValueObject) {
    return createFieldBuilder({
      type: {
        kind: 'valueObject',
        name: resolveValueObjectName(valueObjectName),
      } as {
        readonly kind: 'valueObject';
        readonly name: NormalizeValueObjectName<ValueObject>;
      },
      nullable: false,
      many: false,
    });
  },
  namedType<const Handle extends EnumTypeHandle>(handle: Handle) {
    return createFieldBuilder(
      {
        type: blindCast<
          { readonly kind: 'scalar'; readonly codecId: Handle['codecId'] },
          'literal narrowing: kind is inferred as string without the cast'
        >({
          kind: 'scalar',
          codecId: handle.codecId,
        }),
        nullable: false,
        many: false,
      },
      handle,
    );
  },
} as const;

export function index<const Fields extends MongoIndexFields>(
  fields: Fields,
): {
  readonly fields: Fields;
};
export function index<const Fields extends MongoIndexFields, const Options>(
  fields: Fields,
  options: StrictShape<Options, MongoIndexOptionsInput>,
): {
  readonly fields: Fields;
  readonly options: Options & MongoIndexOptionsInput;
};
export function index(
  fields: MongoIndexFields,
  options?: MongoIndexOptionsInput,
): {
  readonly fields: MongoIndexFields;
  readonly options?: MongoIndexOptionsInput;
} {
  return {
    fields,
    ...(options ? { options } : {}),
  };
}

function createFieldReference<const ModelName extends string, const FieldName extends string>(
  modelName: ModelName,
  fieldName: FieldName,
): FieldReference<ModelName, FieldName> {
  return {
    __kind: 'fieldRef',
    modelName,
    fieldName,
  };
}

function isFieldReference(value: unknown): value is FieldReference<string, string> {
  return (
    typeof value === 'object' && value !== null && '__kind' in value && value.__kind === 'fieldRef'
  );
}

function resolveModelName(value: ModelNameInput): string {
  return typeof value === 'string' ? value : value.__name;
}

function resolveValueObjectName(value: ValueObjectNameInput): string {
  return typeof value === 'string' ? value : value.__name;
}

function normalizeStringList(value: StringListInput): readonly string[] {
  return typeof value === 'string' ? [value] : [...value];
}

function normalizeTargetField(
  targetModelName: string,
  value: string | FieldReference<string, string>,
): string {
  if (!isFieldReference(value)) {
    return value;
  }

  if (value.modelName !== targetModelName) {
    throw contractError(
      'CONTRACT.RELATION_INVALID',
      `Relation target "${targetModelName}" cannot reference field "${value.modelName}.${value.fieldName}".`,
      {
        meta: {
          modelName: targetModelName,
          reason: 'cross-model-field-reference',
          referencedModel: value.modelName,
          referencedField: value.fieldName,
        },
      },
    );
  }

  return value.fieldName;
}

function normalizeTargetFields(
  targetModelName: string,
  value: RelationTargetFieldsInput<string>,
): readonly string[] {
  if (typeof value === 'string') {
    return [value];
  }

  if (isFieldReference(value)) {
    return [normalizeTargetField(targetModelName, value)];
  }

  return value.map((entry) => normalizeTargetField(targetModelName, entry));
}

type ReferenceOptions<
  Target extends ModelNameInput,
  From extends StringListInput,
  To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
> = {
  readonly from: From;
  readonly to: To;
};

type BelongsToOptions<
  Target extends ModelNameInput,
  From extends StringListInput,
  To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
  Nullable extends boolean,
> = ReferenceOptions<Target, From, To> & {
  /**
   * Whether the related document may be absent. Defaults to whether any `from`
   * field is optional; an explicit value that contradicts them is rejected.
   */
  readonly optional: Nullable;
};

type RelationOnFromOptions<
  From extends StringListInput,
  To extends RelationTargetFieldsInput<string>,
> = {
  readonly localFields: NormalizeStringList<From>;
  readonly targetFields: NormalizeTargetFieldList<To>;
};

function createRelationBuilder<
  To extends string,
  Cardinality extends '1:1' | '1:N' | 'N:1',
  On extends RelationOn | undefined,
  Nullable extends boolean | undefined,
>(spec: {
  readonly to: To;
  readonly cardinality: Cardinality;
  readonly on: On;
  readonly nullable: Nullable;
}): RelationBuilder<To, Cardinality, On, Nullable> {
  return {
    __kind: 'relation',
    __to: spec.to,
    __cardinality: spec.cardinality,
    __on: spec.on,
    __nullable: spec.nullable,
  };
}

function createReferenceRelationBuilder<
  Target extends ModelNameInput,
  Cardinality extends '1:1' | '1:N' | 'N:1',
  From extends StringListInput,
  To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
  Nullable extends boolean | undefined,
>(
  target: Target,
  cardinality: Cardinality,
  options: ReferenceOptions<Target, From, To>,
  nullable: Nullable,
): RelationBuilder<
  NormalizeModelName<Target>,
  Cardinality,
  RelationOnFromOptions<From, To>,
  Nullable
> {
  const targetModelName = resolveModelName(target);

  return createRelationBuilder({
    to: targetModelName as NormalizeModelName<Target>,
    cardinality,
    on: {
      localFields: normalizeStringList(options.from) as NormalizeStringList<From>,
      targetFields: normalizeTargetFields(
        targetModelName,
        options.to,
      ) as NormalizeTargetFieldList<To>,
    },
    nullable,
  });
}

function createEmbedRelationBuilder<
  Target extends ModelNameInput,
  Cardinality extends '1:1' | '1:N',
>(
  target: Target,
  cardinality: Cardinality,
): RelationBuilder<NormalizeModelName<Target>, Cardinality, undefined, undefined> {
  return createRelationBuilder({
    to: resolveModelName(target) as NormalizeModelName<Target>,
    cardinality,
    on: undefined,
    nullable: undefined,
  });
}

function hasOne<const Target extends ModelNameInput>(
  target: Target,
): RelationBuilder<NormalizeModelName<Target>, '1:1', undefined, undefined>;
function hasOne<
  const Target extends ModelNameInput,
  const From extends StringListInput,
  const To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
>(
  target: Target,
  options: ReferenceOptions<Target, From, To>,
): RelationBuilder<NormalizeModelName<Target>, '1:1', RelationOnFromOptions<From, To>, true>;
function hasOne(
  target: ModelNameInput,
  options?: ReferenceOptions<ModelNameInput, StringListInput, RelationTargetFieldsInput<string>>,
) {
  if (!options) {
    return createEmbedRelationBuilder(target, '1:1');
  }

  return createReferenceRelationBuilder(target, '1:1', options, true);
}

function hasMany<const Target extends ModelNameInput>(
  target: Target,
): RelationBuilder<NormalizeModelName<Target>, '1:N', undefined, undefined>;
function hasMany<
  const Target extends ModelNameInput,
  const From extends StringListInput,
  const To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
>(
  target: Target,
  options: ReferenceOptions<Target, From, To>,
): RelationBuilder<NormalizeModelName<Target>, '1:N', RelationOnFromOptions<From, To>, undefined>;
function hasMany(
  target: ModelNameInput,
  options?: ReferenceOptions<ModelNameInput, StringListInput, RelationTargetFieldsInput<string>>,
) {
  if (!options) {
    return createEmbedRelationBuilder(target, '1:N');
  }

  return createReferenceRelationBuilder(target, '1:N', options, undefined);
}

function belongsTo<
  const Target extends ModelNameInput,
  const From extends StringListInput,
  const To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
  const Nullable extends boolean,
>(
  target: Target,
  options: BelongsToOptions<Target, From, To, Nullable>,
): RelationBuilder<NormalizeModelName<Target>, 'N:1', RelationOnFromOptions<From, To>, Nullable>;
function belongsTo<
  const Target extends ModelNameInput,
  const From extends StringListInput,
  const To extends RelationTargetFieldsInput<NormalizeModelName<Target>>,
>(
  target: Target,
  options: ReferenceOptions<Target, From, To>,
): RelationBuilder<NormalizeModelName<Target>, 'N:1', RelationOnFromOptions<From, To>, undefined>;
function belongsTo(
  target: ModelNameInput,
  options: ReferenceOptions<ModelNameInput, StringListInput, RelationTargetFieldsInput<string>> & {
    readonly optional?: boolean;
  },
) {
  return createReferenceRelationBuilder(target, 'N:1', options, options.optional);
}

export const rel = {
  belongsTo,
  hasMany,
  hasOne,
} as const;

type ValueObjectInput<Fields extends Record<string, AnyFieldBuilder>> = {
  readonly fields: Fields;
};

export function valueObject<
  const Name extends string,
  const Fields extends Record<string, AnyFieldBuilder>,
>(name: Name, input: ValueObjectInput<Fields>): ValueObjectBuilder<Name, Fields> {
  return {
    __kind: 'valueObject',
    __name: name,
    __fields: input.fields,
  };
}

type ModelDiscriminatorInput<Variants extends Record<string, VariantSpec>> = {
  readonly field: string;
  readonly variants: Variants;
};

type ModelInput<
  Fields extends Record<string, AnyFieldBuilder>,
  Relations extends Record<string, AnyRelationBuilder> | undefined,
  Collection extends string | undefined,
  Indexes extends readonly MongoIndexAuthoringInput[] | undefined,
  CollectionOptions,
  Owner extends ModelNameInput | undefined,
  Base extends ModelNameInput | undefined,
  StorageRelations extends Record<string, StorageRelationSpec> | undefined,
  Discriminator extends ModelDiscriminatorInput<Record<string, VariantSpec>> | undefined,
> = {
  readonly collection?: Collection;
  readonly indexes?: Indexes;
  readonly collectionOptions?: StrictShape<CollectionOptions, MongoCollectionOptionsAuthoringInput>;
  readonly controlPolicy?: ControlPolicy;
  readonly storageRelations?: StorageRelations;
  readonly fields: Fields;
  readonly relations?: Relations;
  readonly owner?: Owner;
  readonly base?: Base;
  readonly discriminator?: Discriminator;
};

export function model<
  const Name extends string,
  const Fields extends Record<string, AnyFieldBuilder>,
  const Relations extends Record<string, AnyRelationBuilder> | undefined = undefined,
  const Collection extends string | undefined = undefined,
  const Indexes extends readonly MongoIndexAuthoringInput[] | undefined = undefined,
  const CollectionOptions = undefined,
  const Owner extends ModelNameInput | undefined = undefined,
  const Base extends ModelNameInput | undefined = undefined,
  const StorageRelations extends Record<string, StorageRelationSpec> | undefined = undefined,
  const Discriminator extends
    | ModelDiscriminatorInput<Record<string, VariantSpec>>
    | undefined = undefined,
>(
  name: Name,
  input: ModelInput<
    Fields,
    Relations,
    Collection,
    Indexes,
    CollectionOptions,
    Owner,
    Base,
    StorageRelations,
    Discriminator
  >,
): ModelBuilder<
  Name,
  Fields,
  Relations extends Record<string, AnyRelationBuilder> ? Relations : Record<never, never>,
  Collection,
  NormalizeModelNameOrUndefined<Owner>,
  NormalizeModelNameOrUndefined<Base>,
  StorageRelations,
  Discriminator extends { readonly field: infer Field extends string }
    ? { readonly field: Field }
    : undefined,
  Discriminator extends { readonly variants: infer Variants extends Record<string, VariantSpec> }
    ? Variants
    : undefined
> {
  return {
    __kind: 'model',
    __name: name,
    __fields: input.fields,
    __relations: (input.relations ?? {}) as Relations extends Record<string, AnyRelationBuilder>
      ? Relations
      : Record<never, never>,
    __indexes: input.indexes,
    __collectionOptions: input.collectionOptions,
    __controlPolicy: input.controlPolicy,
    __collection: input.collection as Collection,
    __owner: (input.owner
      ? resolveModelName(input.owner)
      : undefined) as NormalizeModelNameOrUndefined<Owner>,
    __base: (input.base
      ? resolveModelName(input.base)
      : undefined) as NormalizeModelNameOrUndefined<Base>,
    __storageRelations: input.storageRelations as StorageRelations,
    __discriminator: (input.discriminator
      ? { field: input.discriminator.field }
      : undefined) as Discriminator extends { readonly field: infer Field extends string }
      ? { readonly field: Field }
      : undefined,
    __variants: input.discriminator?.variants as Discriminator extends {
      readonly variants: infer Variants extends Record<string, VariantSpec>;
    }
      ? Variants
      : undefined,
    ref(fieldName) {
      return createFieldReference(name, fieldName);
    },
  };
}

function validateTargetPackRef(
  family: FamilyPackRef<string>,
  target: TargetPackRef<string, string>,
): void {
  if (family.familyId !== 'mongo') {
    throw contractError(
      'CONTRACT.PACK_FAMILY_MISMATCH',
      `defineContract only accepts Mongo family packs. Received family "${family.familyId}".`,
      { meta: { packId: family.id, packFamilyId: family.familyId, contractFamilyId: 'mongo' } },
    );
  }

  if (target.familyId !== family.familyId) {
    throw contractError(
      'CONTRACT.PACK_FAMILY_MISMATCH',
      `target pack "${target.id}" targets family "${target.familyId}" but contract family is "${family.familyId}".`,
      {
        meta: {
          packId: target.id,
          packFamilyId: target.familyId,
          contractFamilyId: family.familyId,
        },
      },
    );
  }
}

function validateExtensionPackRefs(
  target: TargetPackRef<string, string>,
  extensions?: Record<string, ExtensionPackRef<string, string>>,
): void {
  if (!extensions) {
    return;
  }

  for (const packRef of Object.values(extensions)) {
    if (packRef.kind !== 'extension') {
      throw contractError(
        'CONTRACT.PACK_REF_INVALID',
        `defineContract only accepts extension pack refs in extensions. Received kind "${packRef.kind}".`,
        { meta: { packId: packRef.id, kind: packRef.kind } },
      );
    }

    if (packRef.familyId !== target.familyId) {
      throw contractError(
        'CONTRACT.PACK_FAMILY_MISMATCH',
        `extension pack "${packRef.id}" targets family "${packRef.familyId}" but contract target family is "${target.familyId}".`,
        {
          meta: {
            packId: packRef.id,
            packFamilyId: packRef.familyId,
            contractFamilyId: target.familyId,
          },
        },
      );
    }

    if (packRef.targetId && packRef.targetId !== target.targetId) {
      throw contractError(
        'CONTRACT.PACK_TARGET_MISMATCH',
        `extension pack "${packRef.id}" targets "${packRef.targetId}" but contract target is "${target.targetId}".`,
        {
          meta: {
            packId: packRef.id,
            packTargetId: packRef.targetId,
            contractTargetId: target.targetId,
          },
        },
      );
    }
  }
}

function isContractScaffold(
  value: unknown,
): value is ContractScaffold<
  FamilyPackRef<string>,
  TargetPackRef<string, string>,
  Record<string, ExtensionPackRef<string, string>> | undefined,
  Record<string, ModelNameInput> | undefined
> {
  if (typeof value !== 'object' || value === null) {
    return false;
  }

  return 'family' in value && 'target' in value;
}

function buildContractField(builder: AnyFieldBuilder): ContractField {
  const valueSet: ValueSetRef | undefined = builder.__enumHandle
    ? {
        plane: 'domain',
        entityKind: 'enum',
        namespaceId: UNBOUND_NAMESPACE_ID,
        entityName: builder.__enumHandle.enumName,
      }
    : undefined;

  return builder.__many
    ? {
        type: builder.__type,
        nullable: builder.__nullable,
        many: true,
        ...ifDefined('valueSet', valueSet),
      }
    : {
        type: builder.__type,
        nullable: builder.__nullable,
        ...ifDefined('valueSet', valueSet),
      };
}

function buildFields(fields: Record<string, AnyFieldBuilder>): Record<string, ContractField> {
  const builtFields: Record<string, ContractField> = {};

  for (const [fieldName, fieldBuilder] of Object.entries(fields)) {
    builtFields[fieldName] = buildContractField(fieldBuilder);
  }

  return builtFields;
}

function toOneRelationNullable(
  modelName: string,
  relationName: string,
  relationBuilder: AnyRelationBuilder,
  on: RelationOn,
  fields: Record<string, AnyFieldBuilder>,
): boolean {
  const location = `Relation "${modelName}.${relationName}"`;
  const ownsForeignKey = relationBuilder.__cardinality !== '1:1';
  const localFields = ownsForeignKey
    ? on.localFields.map((fieldName) => {
        const localField = fields[fieldName];
        if (localField === undefined) {
          throw contractError(
            'CONTRACT.RELATION_INVALID',
            `${location} joins on local field "${fieldName}", which model "${modelName}" does not declare`,
            { meta: { modelName, relationName, fieldName, reason: 'local-field-unknown' } },
          );
        }
        return localField;
      })
    : [];
  const { nullable, contradiction } = resolveToOneRelationNullable({
    declaredNullable: relationBuilder.__nullable,
    localFieldNullability: localFields.map((localField) => localField.__nullable === true),
    ownsReference: ownsForeignKey,
  });
  if (contradiction !== undefined) {
    throw contractError(
      'CONTRACT.RELATION_INVALID',
      !ownsForeignKey
        ? `${location} is required but does not own the foreign key, so nothing in storage guarantees the related document exists`
        : contradiction === 'declared-optional'
          ? `${location} is optional but every local field it joins on is required`
          : `${location} is required but a local field it joins on is nullable`,
      { meta: { modelName, relationName, reason: 'to-one-nullability-mismatch' } },
    );
  }
  return nullable;
}

function buildRelation(
  modelName: string,
  relationName: string,
  relationBuilder: AnyRelationBuilder,
  fields: Record<string, AnyFieldBuilder>,
): ContractEmbedRelation | ContractReferenceRelation {
  const to = crossRef(relationBuilder.__to, UNBOUND_NAMESPACE_ID);
  const on = relationBuilder.__on;
  if (on === undefined) {
    return { to, cardinality: relationBuilder.__cardinality };
  }
  if (relationBuilder.__cardinality === '1:N') {
    return { to, cardinality: '1:N', on };
  }
  return {
    to,
    cardinality: relationBuilder.__cardinality,
    nullable: toOneRelationNullable(modelName, relationName, relationBuilder, on, fields),
    on,
  };
}

function buildRelations(
  modelName: string,
  relations: Record<string, AnyRelationBuilder>,
  fields: Record<string, AnyFieldBuilder>,
): Record<string, ContractEmbedRelation | ContractReferenceRelation> {
  const builtRelations: Record<string, ContractEmbedRelation | ContractReferenceRelation> = {};

  for (const [relationName, relationBuilder] of Object.entries(relations)) {
    builtRelations[relationName] = buildRelation(modelName, relationName, relationBuilder, fields);
  }

  return builtRelations;
}

function buildValueObjects(
  valueObjects: Record<string, AnyValueObjectBuilder> | undefined,
): Record<string, ContractValueObject> {
  const builtValueObjects: Record<string, ContractValueObject> = {};

  for (const valueObjectBuilder of Object.values(valueObjects ?? {})) {
    if (valueObjectBuilder.__name in builtValueObjects) {
      throw contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Duplicate value object name "${valueObjectBuilder.__name}" in defineContract().`,
        { meta: { kind: 'valueObject', name: valueObjectBuilder.__name } },
      );
    }

    builtValueObjects[valueObjectBuilder.__name] = {
      fields: buildFields(valueObjectBuilder.__fields),
    };
  }

  return builtValueObjects;
}

function buildModels(
  models: Record<string, AnyModelBuilder> | undefined,
): Record<string, ContractModelBase> {
  const builtModels: Record<string, ContractModelBase> = {};

  for (const modelBuilder of Object.values(models ?? {})) {
    if (modelBuilder.__name in builtModels) {
      throw contractError(
        'CONTRACT.NAME_DUPLICATE',
        `Duplicate model name "${modelBuilder.__name}" in defineContract().`,
        { meta: { kind: 'model', name: modelBuilder.__name } },
      );
    }

    const storage = {
      ...(modelBuilder.__collection ? { collection: modelBuilder.__collection } : {}),
      ...(modelBuilder.__storageRelations ? { relations: modelBuilder.__storageRelations } : {}),
    };

    builtModels[modelBuilder.__name] = {
      fields: buildFields(modelBuilder.__fields),
      relations: buildRelations(
        modelBuilder.__name,
        modelBuilder.__relations,
        modelBuilder.__fields,
      ),
      storage,
      ...(modelBuilder.__owner ? { owner: modelBuilder.__owner } : {}),
      ...(modelBuilder.__base ? { base: crossRef(modelBuilder.__base, UNBOUND_NAMESPACE_ID) } : {}),
      ...(modelBuilder.__discriminator ? { discriminator: modelBuilder.__discriminator } : {}),
      ...(modelBuilder.__variants ? { variants: modelBuilder.__variants } : {}),
    };
  }

  return builtModels;
}

function deriveRoots(
  models: Record<string, AnyModelBuilder> | undefined,
): Record<string, CrossReference> {
  const roots: Record<string, CrossReference> = {};

  for (const modelBuilder of Object.values(models ?? {})) {
    if (!modelBuilder.__collection || modelBuilder.__owner || modelBuilder.__base) {
      continue;
    }

    roots[modelBuilder.__collection] = crossRef(modelBuilder.__name, UNBOUND_NAMESPACE_ID);
  }

  return roots;
}

function normalizeRoots(
  roots: Record<string, ModelNameInput> | undefined,
): Record<string, CrossReference> {
  const normalizedRoots: Record<string, CrossReference> = {};

  for (const [rootName, rootValue] of Object.entries(roots ?? {})) {
    normalizedRoots[rootName] = crossRef(resolveModelName(rootValue), UNBOUND_NAMESPACE_ID);
  }

  return normalizedRoots;
}

function toStorageIndex(index: MongoIndexAuthoringInput): MongoIndex {
  const keys = Object.entries(index.fields).map(([field, direction]) => ({
    field,
    direction,
  }));
  const input: Record<string, unknown> = { keys };
  if (index.options) {
    for (const [key, value] of Object.entries(index.options)) {
      if (value !== undefined) {
        input[key] = value;
      }
    }
  }
  return new MongoIndex(input as unknown as MongoIndexInput);
}

function toStorageCollectionOptions(
  opts: MongoCollectionOptionsAuthoringInput,
): MongoCollectionOptions {
  const input: MongoCollectionOptionsInput = {
    ...(opts.capped
      ? { capped: { size: opts.size ?? 0, ...(opts.max != null && { max: opts.max }) } }
      : {}),
    ...ifDefined('storageEngine', opts.storageEngine),
    ...ifDefined('indexOptionDefaults', opts.indexOptionDefaults),
    ...ifDefined('collation', opts.collation),
    ...ifDefined('timeseries', opts.timeseries),
    ...(opts.clusteredIndex !== undefined && {
      clusteredIndex:
        opts.clusteredIndex.name !== undefined ? { name: opts.clusteredIndex.name } : {},
    }),
    ...ifDefined('expireAfterSeconds', opts.expireAfterSeconds),
    ...ifDefined('changeStreamPreAndPostImages', opts.changeStreamPreAndPostImages),
  };
  return new MongoCollectionOptions(input);
}

function findMissingIndexField(
  index: MongoIndexAuthoringInput,
  modelFields: Record<string, unknown>,
): string | undefined {
  for (const fieldName of Object.keys(index.fields)) {
    const wildcardMatch = fieldName.match(/^(.+)\.\$\*\*$/);
    const lookupName = wildcardMatch ? wildcardMatch[1] : fieldName;
    if (lookupName === undefined || lookupName.length === 0) continue;
    if (lookupName === '$**') continue;
    if (!Object.hasOwn(modelFields, lookupName)) {
      return lookupName;
    }
  }
  return undefined;
}

function resolveVariantScope(
  modelBuilder: AnyModelBuilder,
  modelsByName: Record<string, AnyModelBuilder>,
): { discriminatorField: string; discriminatorValue: string } | undefined {
  if (!modelBuilder.__base) return undefined;
  const baseBuilder = modelsByName[modelBuilder.__base];
  if (!baseBuilder) return undefined;
  const discriminatorField = baseBuilder.__discriminator?.field;
  const variantValue = baseBuilder.__variants?.[modelBuilder.__name]?.value;
  if (!discriminatorField || variantValue === undefined) return undefined;
  return { discriminatorField, discriminatorValue: variantValue };
}

function scopeVariantIndex(
  storageIndex: MongoIndex,
  scope: { discriminatorField: string; discriminatorValue: string },
  variantName: string,
  authoredIndex: MongoIndexAuthoringInput | undefined,
): MongoIndex {
  const result = applyPolymorphicScopeToMongoIndex(storageIndex, scope);
  if (result.kind === 'conflict') {
    const indexLabel = authoredIndex ? canonicalStringify(authoredIndex) : '<unknown>';
    throw contractError(
      'CONTRACT.INDEX_INVALID',
      `Variant model "${variantName}" index ${indexLabel} conflicts with discriminator scope: ${result.reason}`,
      { meta: { variantName, indexLabel, reason: result.reason } },
    );
  }
  return result.index;
}

function buildCollections(
  models: Record<string, AnyModelBuilder> | undefined,
): Record<string, MongoCollectionInput> {
  const intermediate: Record<string, MongoCollectionInput> = {};
  const declaredIndexOwners = new Map<string, string>();
  const modelMap = models ?? {};
  const modelsByName: Record<string, AnyModelBuilder> = {};
  for (const builder of Object.values(modelMap)) {
    modelsByName[builder.__name] = builder;
  }

  for (const modelBuilder of Object.values(modelMap)) {
    if (!modelBuilder.__collection) {
      if (modelBuilder.__indexes && modelBuilder.__indexes.length > 0) {
        throw contractError(
          'CONTRACT.COLLECTION_INVALID',
          `Model "${modelBuilder.__name}" defines indexes but has no collection to attach them to.`,
          { meta: { modelName: modelBuilder.__name, reason: 'indexes-without-collection' } },
        );
      }

      if (modelBuilder.__collectionOptions) {
        throw contractError(
          'CONTRACT.COLLECTION_INVALID',
          `Model "${modelBuilder.__name}" defines collectionOptions but has no collection to attach them to.`,
          {
            meta: {
              modelName: modelBuilder.__name,
              reason: 'collectionOptions-without-collection',
            },
          },
        );
      }

      if (modelBuilder.__controlPolicy) {
        throw contractError(
          'CONTRACT.COLLECTION_INVALID',
          `Model "${modelBuilder.__name}" defines controlPolicy but has no collection to attach it to.`,
          { meta: { modelName: modelBuilder.__name, reason: 'controlPolicy-without-collection' } },
        );
      }

      continue;
    }

    const existingCollection: MongoCollectionInput = intermediate[modelBuilder.__collection] ?? {};
    const existingIndexes = existingCollection.indexes ?? [];

    if (existingCollection.options && modelBuilder.__collectionOptions) {
      throw contractError(
        'CONTRACT.COLLECTION_INVALID',
        `Collection "${modelBuilder.__collection}" has collectionOptions declared by multiple models. Author collectionOptions on a single model per collection.`,
        {
          meta: {
            modelName: modelBuilder.__name,
            collection: modelBuilder.__collection,
            reason: 'collectionOptions-declared-by-multiple-models',
          },
        },
      );
    }

    if (existingCollection.control !== undefined && modelBuilder.__controlPolicy) {
      throw contractError(
        'CONTRACT.COLLECTION_INVALID',
        `Collection "${modelBuilder.__collection}" has controlPolicy declared by multiple models. Author controlPolicy on a single model per collection.`,
        {
          meta: {
            modelName: modelBuilder.__name,
            collection: modelBuilder.__collection,
            reason: 'controlPolicy-declared-by-multiple-models',
          },
        },
      );
    }

    for (const collectionIndex of modelBuilder.__indexes ?? []) {
      const missingField = findMissingIndexField(collectionIndex, modelBuilder.__fields);
      if (missingField !== undefined) {
        const indexSignature = canonicalStringify(collectionIndex);
        throw contractError(
          'CONTRACT.FIELD_UNKNOWN',
          `Model "${modelBuilder.__name}" index ${indexSignature} references unknown field "${missingField}".`,
          {
            meta: { modelName: modelBuilder.__name, fieldName: missingField, indexSignature },
          },
        );
      }
    }

    const polymorphicScope = resolveVariantScope(modelBuilder, modelsByName);
    const rawStorageIndexes = (modelBuilder.__indexes ?? []).map(toStorageIndex);
    const storageIndexes = polymorphicScope
      ? rawStorageIndexes.map((idx, i) =>
          scopeVariantIndex(
            idx,
            polymorphicScope,
            modelBuilder.__name,
            modelBuilder.__indexes?.[i],
          ),
        )
      : rawStorageIndexes;

    // Dedup after scoping so sibling variants that authentically declare
    // identical raw indexes (e.g. Bug and Feature both index severity) do
    // not collide — their post-scoping storage indexes differ by
    // partialFilterExpression and are correctly distinct on MongoDB.
    for (let i = 0; i < storageIndexes.length; i++) {
      const storageIndex = storageIndexes[i];
      if (storageIndex === undefined) continue;
      const indexSignature = stableStringify(storageIndex);
      const collectionIndexKey = `${modelBuilder.__collection}:${indexSignature}`;
      const firstOwner = declaredIndexOwners.get(collectionIndexKey);
      if (firstOwner) {
        const authoredIndex = modelBuilder.__indexes?.[i];
        const reportedSignature = authoredIndex
          ? canonicalStringify(authoredIndex)
          : indexSignature;
        throw contractError(
          'CONTRACT.NAME_DUPLICATE',
          `Collection "${modelBuilder.__collection}" defines duplicate index ${reportedSignature}. First declared on model "${firstOwner}" and duplicated on model "${modelBuilder.__name}".`,
          {
            meta: {
              kind: 'index',
              name: reportedSignature,
              collection: modelBuilder.__collection,
              first: firstOwner,
              second: modelBuilder.__name,
            },
          },
        );
      }
      declaredIndexOwners.set(collectionIndexKey, modelBuilder.__name);
    }
    const storageOptions = modelBuilder.__collectionOptions
      ? toStorageCollectionOptions(modelBuilder.__collectionOptions)
      : undefined;
    const controlPatch =
      modelBuilder.__controlPolicy !== undefined ? { control: modelBuilder.__controlPolicy } : {};

    intermediate[modelBuilder.__collection] =
      storageIndexes.length > 0
        ? {
            ...existingCollection,
            indexes: [...existingIndexes, ...storageIndexes],
            ...(storageOptions ? { options: storageOptions } : {}),
            ...controlPatch,
          }
        : storageOptions
          ? {
              ...existingCollection,
              options: storageOptions,
              ...controlPatch,
            }
          : Object.keys(controlPatch).length > 0
            ? { ...existingCollection, ...controlPatch }
            : existingCollection;
  }

  return intermediate;
}

function buildContractFromDefinition<
  const Definition extends ContractDefinition<
    FamilyPackRef<string>,
    TargetPackRef<string, string>,
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    Record<string, ModelNameInput> | undefined
  >,
>(definition: Definition): MongoContractResult<Definition> {
  validateTargetPackRef(definition.family, definition.target);
  validateExtensionPackRefs(definition.target, definition.extensions);

  const builtModels = buildModels(definition.models);
  const builtValueObjects = buildValueObjects(definition.valueObjects);
  const roots = definition.roots
    ? normalizeRoots(definition.roots)
    : deriveRoots(definition.models);
  // The Mongo `defineContract` input no longer accepts a `capabilities`
  // block. The build-time matrix is empty here; CLI-time `enrichContract`
  // layers in adapter / driver / extension caps. `profileHash` continues
  // to fingerprint this (now-always-empty) author subset, so it stabilises
  // at `hash({})`.
  const capabilities: Record<string, Record<string, boolean>> = {};
  const collections = buildCollections(definition.models);

  // Resolve the target's codecs by id from the pack the contract binds, then encode each enum's
  // member values through `codec.encodeJson` — the same real codecs the runtime/control stacks use.
  const codecLookup = extractCodecLookup([definition.target]);

  // The value set stores each enum's codec-encoded member values (mirroring SQL's build-contract).
  const storageValueSets: Record<string, MongoValueSetInput> = {};
  for (const [enumName, handle] of Object.entries(definition.enums ?? {})) {
    storageValueSets[enumName] = {
      kind: 'valueSet',
      values: handle.values.map((v) => encodeEnumValue(v, handle.codecId, codecLookup)),
    };
  }
  const hasValueSets = Object.keys(storageValueSets).length > 0;

  const unboundNamespace = buildMongoNamespace({
    id: UNBOUND_NAMESPACE_ID,
    entries: {
      collection: collections,
      ...ifDefined('valueSet', hasValueSets ? storageValueSets : undefined),
    },
  });
  // Hash the constructed (normalized) entries, not the raw input literals —
  // persisted storageHash values were computed over the constructed form.
  const storageBody = {
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: {
        id: UNBOUND_NAMESPACE_ID,
        collections: unboundNamespace.entries.collection,
        ...ifDefined('valueSet', unboundNamespace.entries.valueSet),
      },
    },
  };

  const storageHash = computeStorageHash({
    target: definition.target.targetId,
    targetFamily: definition.family.familyId,
    storage: storageBody,
    ...mongoContractCanonicalizationHooks,
  });

  const storage = new MongoStorage({
    storageHash,
    namespaces: {
      [UNBOUND_NAMESPACE_ID]: unboundNamespace,
    },
  }) as unknown as MongoStorageShape<string>;

  const builtEnums: Record<string, ContractEnum> = {};
  for (const [enumName, handle] of Object.entries(definition.enums ?? {})) {
    if (enumName !== handle.enumName) {
      throw contractError(
        'CONTRACT.ENUM_INVALID',
        `enum declaration key "${enumName}" must match enumType name "${handle.enumName}". Aliases are not supported.`,
        {
          meta: {
            enumName: handle.enumName,
            declaredKey: enumName,
            reason: 'declaration-key-mismatch',
          },
        },
      );
    }
    builtEnums[enumName] = {
      codecId: handle.codecId,
      members: handle.enumMembers.map((m) => ({
        name: m.name,
        value: encodeEnumValue(m.value, handle.codecId, codecLookup),
      })),
    };
  }
  const hasEnums = Object.keys(builtEnums).length > 0;

  for (const [modelName, modelBuilder] of Object.entries(definition.models ?? {})) {
    for (const [fieldName, fieldBuilder] of Object.entries(modelBuilder.__fields)) {
      const handle = fieldBuilder.__enumHandle;
      if (handle && !(handle.enumName in builtEnums)) {
        throw contractError(
          'CONTRACT.ENUM_UNKNOWN',
          `Model "${modelName}" field "${fieldName}" references enum "${handle.enumName}" which is not declared in defineContract({ enums: { ... } }).`,
          { meta: { modelName, fieldName, enumName: handle.enumName } },
        );
      }
    }
  }

  const builtContract = {
    target: definition.target.targetId,
    targetFamily: definition.family.familyId,
    ...ifDefined('defaultControlPolicy', definition.defaultControlPolicy),
    roots,
    domain: {
      namespaces: {
        [UNBOUND_NAMESPACE_ID]: {
          models: builtModels,
          ...(Object.keys(builtValueObjects).length > 0 ? { valueObjects: builtValueObjects } : {}),
          ...(hasEnums ? { enum: builtEnums } : {}),
        },
      },
    },
    storage,
    capabilities,
    extensions: definition.extensions ?? {},
    profileHash: computeProfileHash({
      target: definition.target.targetId,
      targetFamily: definition.family.familyId,
      capabilities,
    }),
    meta: {},
  } satisfies MongoContract;

  return blindCast<
    MongoContractResult<Definition>,
    "builtContract satisfies MongoContract erases Definition's literal type parameters; MongoContractResult<Definition> re-applies them so callers see the precise model/value-object/roots/namespace shapes"
  >(builtContract);
}

// Input for buildBoundContract that omits family/target (injected by the builder).
type BoundDefinitionInput<
  Models extends Record<string, AnyModelBuilder> = Record<never, never>,
  ValueObjects extends Record<string, AnyValueObjectBuilder> = Record<never, never>,
  Extensions extends Record<string, ExtensionPackRef<string, string>> | undefined = undefined,
  Roots extends Record<string, ModelNameInput> | undefined = undefined,
> = {
  readonly extensions?: Extensions;
  readonly roots?: Roots;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly models?: Models;
  readonly valueObjects?: ValueObjects;
  readonly enums?: Record<string, EnumTypeHandle>;
};

// Merges a bound input with the pre-bound family/target to produce a full ContractDefinition.
type WithFamilyTarget<
  Input,
  F extends FamilyPackRef<string>,
  T extends TargetPackRef<string, string>,
> = Input & { readonly family: F; readonly target: T };

/**
 * Shared builder that assembles a MongoContract with pre-bound family and target.
 * Extension wrappers keep their own public overloads and delegate their impl body here;
 * this is a plain overloaded function (not a factory returning an overloaded function)
 * so no overloaded-function-return cast is needed.
 *
 * Overload 1: definition form (no factory).
 */
export function buildBoundContract<
  const F extends FamilyPackRef<string>,
  const T extends TargetPackRef<string, string>,
  const Definition extends BoundDefinitionInput<
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    Record<string, ModelNameInput> | undefined
  >,
>(
  family: F,
  target: T,
  definition: Definition,
  factory?: undefined,
): MongoContractResult<WithFamilyTarget<Definition, F, T>>;
/**
 * Overload 2: factory form.
 */
export function buildBoundContract<
  const F extends FamilyPackRef<string>,
  const T extends TargetPackRef<string, string>,
  const Definition extends BoundDefinitionInput<
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    Record<string, ModelNameInput> | undefined
  >,
  const Built extends {
    readonly models?: Record<string, AnyModelBuilder>;
    readonly valueObjects?: Record<string, AnyValueObjectBuilder>;
    readonly roots?: Record<string, ModelNameInput> | undefined;
  },
>(
  family: F,
  target: T,
  definition: Definition,
  factory: (
    helpers: ContractAuthoringHelpers<F, T, NonNullable<Definition['extensions']>>,
  ) => Built,
): MongoContractResult<WithFamilyTarget<Definition & Built, F, T>>;
/** Implementation. */
export function buildBoundContract<
  const F extends FamilyPackRef<string>,
  const T extends TargetPackRef<string, string>,
  const Definition extends BoundDefinitionInput<
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    Record<string, ModelNameInput> | undefined
  >,
  const Built extends {
    readonly models?: Record<string, AnyModelBuilder>;
    readonly valueObjects?: Record<string, AnyValueObjectBuilder>;
    readonly roots?: Record<string, ModelNameInput> | undefined;
  },
>(
  family: F,
  target: T,
  definition: Definition,
  factory?:
    | ((helpers: ContractAuthoringHelpers<F, T, NonNullable<Definition['extensions']>>) => Built)
    | undefined,
) {
  const full = { ...definition, family, target };

  if (factory !== undefined) {
    const entities = composeMongoEntityHelpers(family, target, definition.extensions);
    // composeMongoEntityHelpers returns Record<string, unknown> via an opaque runtime
    // namespace walk; there is no way to reconstruct ContractAuthoringHelpers<F,T,Ext>
    // structurally from that return type, so this single cast is irreducible.
    const helpers = {
      ...entities,
      field,
      index,
      model,
      rel,
      valueObject,
    } as unknown as ContractAuthoringHelpers<F, T, NonNullable<Definition['extensions']>>;
    const built = factory(helpers);
    return buildContractFromDefinition({
      ...full,
      ...ifDefined('models', built.models),
      ...ifDefined('valueObjects', built.valueObjects),
      ...ifDefined('roots', built.roots),
    });
  }

  return buildContractFromDefinition(full);
}

export function defineContract<
  const Definition extends ContractDefinition<
    FamilyPackRef<string>,
    TargetPackRef<string, string>,
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    Record<string, ModelNameInput> | undefined
  >,
>(definition: Definition): MongoContractResult<Definition>;
export function defineContract<
  const Definition extends ContractScaffold<
    Family,
    Target,
    Extensions,
    Record<string, ModelNameInput> | undefined
  >,
  const Built extends {
    readonly models?: Record<string, AnyModelBuilder>;
    readonly valueObjects?: Record<string, AnyValueObjectBuilder>;
    readonly roots?: Record<string, ModelNameInput> | undefined;
  },
  const Family extends FamilyPackRef<string> = FamilyPackRef<string>,
  const Target extends TargetPackRef<string, string> = TargetPackRef<string, string>,
  const Extensions extends Record<string, ExtensionPackRef<string, string>> | undefined = undefined,
>(
  definition: Definition,
  factory: (helpers: ContractAuthoringHelpers<Family, Target, Extensions>) => Built,
): MongoContractResult<Definition & Built>;
export function defineContract(
  definition: ContractScaffold<
    FamilyPackRef<string>,
    TargetPackRef<string, string>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    Record<string, ModelNameInput> | undefined
  >,
  factory?: ContractFactory<
    Record<string, AnyModelBuilder>,
    Record<string, AnyValueObjectBuilder>,
    Record<string, ModelNameInput> | undefined
  >,
) {
  if (!isContractScaffold(definition)) {
    throw contractError(
      'CONTRACT.ARGUMENT_INVALID',
      'defineContract expects a contract definition object. Define your contract with defineContract({ family, target, models, ... }).',
    );
  }

  if (factory !== undefined) {
    return buildBoundContract(definition.family, definition.target, definition, factory);
  }
  return buildBoundContract(definition.family, definition.target, definition);
}
