import type {
  ContractExecutionSection,
  ContractFieldType,
  ControlPolicy,
  CrossReference,
  EnumMemberValueType,
  ExecutionHashBase,
  ExecutionMutationDefault,
  ExecutionMutationDefaultPhases,
  FieldTypesFromDomain,
  JsonValue,
  ProfileHashBase,
  StorageHashBase,
} from '@internal/contract/types';
import {
  composePackAuthoringNamespace,
  createEntityHelpersFromNamespace,
  type EntityHelpersFromNamespace,
  type ExtractAuthoringNamespaceFromPack,
  type ExtractParameterizedOutputTypesFromPack,
  type MergeExtensionAuthoringNamespaces,
} from '@internal/contract-authoring';
import {
  assembleDataTypeSupport,
  assertNoCrossRegistryCollisions,
  assertTypeAliasesValid,
  type DataTypeSupport,
  flushAuthoringWarnings,
} from '@internal/framework-components/authoring';
import type { CodecLookupWithDescriptors } from '@internal/framework-components/codec';
import {
  assembleGeneratorFunctions,
  createGeneratorHelpers,
  type ExtensionPackRef,
  type ExtensionPackValues,
  type FamilyPackRef,
  type GeneratorFunctionCall,
  type GeneratorHelpersOf,
  type GeneratorPhase,
  type TargetPackRef,
} from '@internal/framework-components/components';
import { extractCodecLookup } from '@internal/framework-components/control';
import type { UNBOUND_NAMESPACE_ID } from '@internal/framework-components/ir';
import type {
  MongoCollection,
  MongoCollectionOptionsAuthoringInput,
  MongoContractWithTypeMaps,
  MongoIndexAuthoringInput,
  MongoIndexFields,
  MongoIndexOptionsInput,
  MongoStorageShape,
  MongoTypeMaps,
} from '@internal/mongo-contract';
import type { BsonInputValue, BsonValue } from '@internal/mongo-value';
import { assertDefined } from '@internal/utils/assertions';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { buildMongoContractFromDefinition } from './build-contract';
import {
  type AnyFieldBuilder,
  type AnyFieldReference,
  type AnyModelBuilder,
  type AnyRelationBuilder,
  type AnyValueObjectBuilder,
  type FieldBuilder,
  type FieldGeneratorCalls,
  type FieldReference,
  type ModelBuilder,
  type ModelNameInput,
  type NamedModelBuilder,
  type NamedValueObjectBuilder,
  type RelationBuilder,
  type RelationOn,
  resolveModelName,
  type StorageRelationSpec,
  type ValueObjectBuilder,
  type VariantSpec,
  type WithGeneratedPhase,
} from './contract-dsl';
import { contractError } from './contract-errors';
import { buildContractDefinition, type DslContractInput } from './contract-lowering';
import type { EnumTypeHandle } from './enum-type';
import { authoringWarningOf, refusalError } from './refusal-errors';
import { refusingRemovedFieldPresets } from './removed-field-presets';

type StringListInput = string | readonly string[];
type Present<T> = Exclude<T, undefined>;
type EmptyObject = Record<never, never>;
type Simplify<T> = { [K in keyof T]: T[K] } & EmptyObject;
type Flatten<T> = { [K in keyof T]: T[K] };
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
  readonly 'mongo/objectId@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'equality';
  };
  readonly 'mongo/string@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'equality' | 'order' | 'textual';
  };
  readonly 'mongo/double@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/int32@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/bool@1': {
    readonly input: boolean;
    readonly output: boolean;
    readonly traits: 'equality' | 'boolean';
  };
  readonly 'mongo/date@1': {
    readonly input: Date;
    readonly output: Date;
    readonly traits: 'equality' | 'order';
  };
  readonly 'mongo/vector@1': {
    readonly input: readonly number[];
    readonly output: readonly number[];
    readonly traits: 'equality';
  };
  readonly 'mongo/int64@1': {
    readonly input: bigint;
    readonly output: bigint;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/int64Number@1': {
    readonly input: number;
    readonly output: number;
    readonly traits: 'equality' | 'order' | 'numeric';
  };
  readonly 'mongo/decimal128@1': {
    readonly input: string;
    readonly output: string;
    readonly traits: 'equality' | 'order' | 'numeric';
    readonly keepsWrittenForm: true;
  };
  readonly 'mongo/binary@1': {
    readonly input: Uint8Array;
    readonly output: Uint8Array;
    readonly traits: 'equality';
  };
  readonly 'mongo/json@1': {
    readonly input: JsonValue;
    readonly output: JsonValue;
    readonly traits: never;
  };
  readonly 'mongo/bson@1': {
    readonly input: BsonInputValue;
    readonly output: BsonValue;
    readonly traits: never;
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
      ? Record<never, never>
      : MergeExtensionCodecTypes<Packs>
    : Record<never, never>;

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
    infer Many extends false | { readonly elementNullable: boolean },
    EnumTypeHandle | undefined,
    ExecutionMutationDefaultPhases | undefined
  >
    ? Simplify<{
        readonly type: Type;
        readonly nullable: Nullable;
        readonly many: Many;
      }>
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
    ? Fields[Name] extends FieldBuilder<
        ContractFieldType,
        true,
        false | { readonly elementNullable: boolean },
        EnumTypeHandle | undefined,
        ExecutionMutationDefaultPhases | undefined
      >
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

type StoredNameFromBuilder<TBuilder, FieldName extends string> = TBuilder extends {
  readonly __storedName: infer StoredName extends string;
}
  ? StoredName
  : FieldName;

type StorageFieldsFromRecord<Fields extends Record<string, AnyFieldBuilder>> =
  keyof Fields extends never
    ? Record<string, never>
    : {
        readonly [K in keyof Fields & string]: {
          readonly field: StoredNameFromBuilder<Fields[K], K>;
        };
      };

type ContractModelStorageFromBuilder<
  TBuilder,
  Fields extends Record<string, AnyFieldBuilder>,
> = Simplify<
  ModelStorageSection<TBuilder> & {
    readonly fields: StorageFieldsFromRecord<Fields>;
  } & ModelStorageRelationsSection<TBuilder>
>;

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
  : {
      readonly variants: {
        readonly [K in keyof Variants & string as Variants[K] extends {
          readonly value: infer Value extends string;
        }
          ? Value
          : never]: CrossRefFor<K>;
      };
    };

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
          readonly storage: ContractModelStorageFromBuilder<TBuilder, Fields>;
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

type ScaffoldExtensions<Definition> = Definition extends {
  readonly extensions?: infer Extensions extends Record<string, ExtensionPackRef<string, string>>;
}
  ? Extensions
  : undefined;

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

type HandleName<Handle> = Handle extends EnumTypeHandle<infer Name> ? Name : never;

// A member is stored in its codec's JSON form, which is the authored literal only when that literal is JSON; a bigint or Date member is stored as text.
type StoredEnumValue<Value> = Value extends JsonValue ? Value : JsonValue;

type EnumHandleMembers<Handle, Stored extends boolean> =
  Handle extends EnumTypeHandle<string, infer Values, infer Names>
    ? {
        readonly [I in keyof Values]: {
          readonly name: I extends keyof Names ? Names[I] : never;
          readonly value: Stored extends true ? StoredEnumValue<Values[I]> : Values[I];
        };
      }
    : never;

// The domain `enum` entries for enums authored with `enumType`, keyed by enum name, with each member's value as it is stored.
type EnumHandleEntries<Enums> = {
  readonly [K in keyof Enums as HandleName<Enums[K]>]: {
    readonly codecId: Enums[K] extends { readonly codecId: infer CodecId } ? CodecId : string;
    readonly members: EnumHandleMembers<Enums[K], true>;
  };
};

// The `enumMemberTypes` for enums authored with `enumType`: each member with the value the application reads, as an emitted `contract.d.ts` types it. `db.enums` reads its accessors from it.
type EnumHandleMemberTypes<Enums, CodecTypes> = {
  readonly [K in keyof Enums as HandleName<Enums[K]>]: Enums[K] extends EnumTypeHandle<
    string,
    infer Values,
    infer Names,
    Record<string, unknown>,
    infer CodecId
  >
    ? {
        readonly [I in keyof Values]: {
          readonly name: I extends keyof Names ? Names[I] : never;
          readonly value: EnumMemberValueType<CodecTypes, CodecId, Values[I]>;
        };
      }
    : never;
};

type MaybeEnumsSection<
  Enums extends Record<string, EnumTypeHandle>,
  CodecTypes,
> = keyof Enums extends never
  ? EmptyObject
  : {
      readonly enum: EnumHandleEntries<Enums>;
      readonly enumMemberTypes?: EnumHandleMemberTypes<Enums, CodecTypes>;
    };

type MongoDomainNamespaceFromDefinition<Definition> = Simplify<
  {
    readonly models: ContractModelsFromRecord<DefinitionModels<Definition>>;
  } & MaybeValueObjectsSection<DefinitionValueObjects<Definition>> &
    MaybeEnumsSection<DefinitionEnums<Definition>, CodecTypesFromDefinition<Definition>>
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
  readonly execution?: ExecutionSectionFromDefinition<Definition>;
}>;

type ModelExecutionDefaults<TBuilder> =
  ExtractModelCollection<TBuilder> extends infer Entry extends string
    ? {
        [FieldName in keyof ExtractModelFields<TBuilder> &
          string]: ExtractModelFields<TBuilder>[FieldName] extends {
          readonly __executionDefaults?: infer Phases extends ExecutionMutationDefaultPhases;
        }
          ? keyof Phases extends never
            ? never
            : {
                readonly ref: {
                  readonly namespace: typeof UNBOUND_NAMESPACE_ID;
                  readonly entry: Entry;
                  readonly field: StoredNameFromBuilder<
                    ExtractModelFields<TBuilder>[FieldName],
                    FieldName
                  >;
                };
              } & Phases
          : never;
      }[keyof ExtractModelFields<TBuilder> & string]
    : never;

type ExecutionDefaultsFromDefinition<Definition> = {
  [ModelKey in keyof DefinitionModels<Definition>]: ModelExecutionDefaults<
    DefinitionModels<Definition>[ModelKey]
  >;
}[keyof DefinitionModels<Definition>];

type ExecutionSectionFromDefinition<Definition> = [
  ExecutionDefaultsFromDefinition<Definition>,
] extends [never]
  ? ContractExecutionSection
  : {
      readonly executionHash: ExecutionHashBase<string>;
      readonly mutations: {
        readonly defaults: ReadonlyArray<
          Extract<Flatten<ExecutionDefaultsFromDefinition<Definition>>, ExecutionMutationDefault>
        >;
      };
    };

type CodecTypesFromDefinition<Definition> = MongoCodecTypes &
  MergeExtensionCodecTypesSafe<DefinitionExtensions<Definition>>;

// The enum value union for a field builder — `EnumTypeHandle['values'][number]`
// when the builder carries an enum handle, `never` otherwise.
type BuilderEnumValueUnion<TBuilder> =
  TBuilder extends FieldBuilder<
    ContractFieldType,
    boolean,
    false | { readonly elementNullable: boolean },
    infer Handle extends EnumTypeHandle | undefined,
    ExecutionMutationDefaultPhases | undefined
  >
    ? [Handle] extends [EnumTypeHandle<string, infer Values>]
      ? readonly unknown[] extends Values
        ? never
        : Values[number]
      : never
    : never;

type ExtractModelFields<TBuilder> =
  TBuilder extends NamedModelBuilder<string, infer Fields> ? Fields : Record<never, never>;

// An enum field reads and writes the members of its enum, which its codec does not give.
type BuilderFieldTypeOverride<TBuilder> = [BuilderEnumValueUnion<TBuilder>] extends [never]
  ? never
  : {
      readonly output: BuilderEnumValueUnion<TBuilder>;
      readonly input: BuilderEnumValueUnion<TBuilder>;
    };

type ExtractValueObjectFields<TBuilder> =
  TBuilder extends NamedValueObjectBuilder<string, infer Fields> ? Fields : Record<never, never>;

type FieldTypeOverridesFromDefinition<Definition> = {
  readonly [K in typeof UNBOUND_NAMESPACE_ID]: {
    readonly models: {
      readonly [ModelKey in keyof DefinitionModels<Definition> as ExtractModelName<
        DefinitionModels<Definition>[ModelKey]
      >]: {
        readonly [FieldName in keyof ExtractModelFields<
          DefinitionModels<Definition>[ModelKey]
        >]: BuilderFieldTypeOverride<
          ExtractModelFields<DefinitionModels<Definition>[ModelKey]>[FieldName]
        >;
      };
    };
    readonly valueObjects: {
      readonly [Key in keyof DefinitionValueObjects<Definition> as ExtractValueObjectName<
        DefinitionValueObjects<Definition>[Key]
      >]: {
        readonly [FieldName in keyof ExtractValueObjectFields<
          DefinitionValueObjects<Definition>[Key]
        >]: BuilderFieldTypeOverride<
          ExtractValueObjectFields<DefinitionValueObjects<Definition>[Key]>[FieldName]
        >;
      };
    };
  };
};

type DefinitionTarget<Definition> = Definition extends { readonly target: infer Target }
  ? Target
  : never;

type ParameterizedOutputTypesFromDefinition<Definition> =
  | ExtractParameterizedOutputTypesFromPack<DefinitionTarget<Definition>>
  | {
      [K in keyof DefinitionExtensions<Definition>]: ExtractParameterizedOutputTypesFromPack<
        DefinitionExtensions<Definition>[K]
      >;
    }[keyof DefinitionExtensions<Definition>];

type FieldTypesFromDefinition<Definition, Side extends 'output' | 'input'> = FieldTypesFromDomain<
  MongoContractBaseFromDefinition<Definition>['domain']['namespaces'],
  CodecTypesFromDefinition<Definition>,
  ParameterizedOutputTypesFromDefinition<Definition>,
  FieldTypeOverridesFromDefinition<Definition>,
  Side
>;

export type MongoContractResult<Definition> = MongoContractWithTypeMaps<
  MongoContractBaseFromDefinition<Definition>,
  MongoTypeMaps<
    CodecTypesFromDefinition<Definition>,
    FieldTypesFromDefinition<Definition, 'output'>,
    FieldTypesFromDefinition<Definition, 'input'>
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
  readonly gen: GeneratorHelpersOf<Family | Target | ExtensionPackValues<Extensions>>;
};

const MONGO_RESERVED_HELPER_KEYS: readonly string[] = [
  'field',
  'gen',
  'index',
  'model',
  'rel',
  'valueObject',
];

interface StackLookups {
  readonly codecLookup: CodecLookupWithDescriptors;
  readonly dataTypes: DataTypeSupport;
}

type StackComponent =
  | FamilyPackRef<string>
  | TargetPackRef<string, string>
  | ExtensionPackRef<string, string>;

function stackLookupsOf(components: readonly StackComponent[]): StackLookups {
  const codecLookup = extractCodecLookup(components);
  assertTypeAliasesValid(composePackAuthoringNamespace(components, 'type'), {
    generatorFunctions: assembleGeneratorFunctions(components),
    paramsSchemaOf: (codecId) => codecLookup.descriptorFor(codecId)?.paramsSchema,
    fieldLength: () => undefined,
  });
  const { support } = assembleDataTypeSupport(
    components,
    (codecId) => codecLookup.descriptorFor(codecId)?.dataType,
  );
  return { codecLookup, dataTypes: support };
}

function composeMongoAuthoringHelpers<
  Family extends FamilyPackRef<string>,
  Target extends TargetPackRef<string, string>,
  Extensions extends Record<string, ExtensionPackRef<string, string>> | undefined,
>(
  family: Family,
  target: Target,
  extensions: Extensions | undefined,
  lookups: StackLookups,
): ContractAuthoringHelpers<Family, Target, Extensions> {
  const extensionPacks: Record<string, ExtensionPackRef<string, string>> = extensions ?? {};
  const components = [family, target, ...Object.values(extensionPacks)];
  const entityNamespace = composePackAuthoringNamespace(components, 'entityTypes');
  assertNoCrossRegistryCollisions(
    composePackAuthoringNamespace(components, 'type'),
    entityNamespace,
  );
  // Pack-contributed entity types flatten onto the same top-level shape
  // as the built-in helpers (`model`, `rel`, `field`, `index`,
  // `valueObject`). Detect collisions explicitly so a contributed name
  // can't silently overwrite a built-in at runtime.
  const collisions = Object.keys(entityNamespace).filter((name) =>
    MONGO_RESERVED_HELPER_KEYS.includes(name),
  );
  if (collisions.length > 0) {
    throw contractError(
      'CONTRACT.PACK_CONTRIBUTION_INVALID',
      `Pack-contributed entity type(s) ${collisions.map((c) => `"${c}"`).join(', ')} collide with the reserved built-in helper key(s) on the Mongo composed helpers surface. Reserved keys: ${MONGO_RESERVED_HELPER_KEYS.map((k) => `"${k}"`).join(', ')}.`,
      { meta: { reason: 'reserved-helper-key-collision', contribution: collisions } },
    );
  }
  return blindCast<
    ContractAuthoringHelpers<Family, Target, Extensions>,
    'entity helpers are built by a runtime walk of the pack namespaces, which returns Record<string, unknown>; their static shape comes from the pack type parameters'
  >({
    ...createEntityHelpersFromNamespace(entityNamespace, {
      ctx: {
        family: family.familyId,
        target: target.targetId,
        codecLookup: lookups.codecLookup,
        dataTypes: lookups.dataTypes,
      },
    }),
    field,
    gen: createGeneratorHelpers(components),
    index,
    model,
    rel,
    valueObject,
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

export type ContractInput<
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
  Many extends false | { readonly elementNullable: boolean },
> = {
  readonly type: Type;
  readonly nullable: Nullable;
  readonly many: Many;
};

function createFieldBuilder<
  Type extends ContractFieldType,
  Nullable extends boolean,
  Many extends false | { readonly elementNullable: boolean },
  Handle extends EnumTypeHandle | undefined = undefined,
  ExecutionDefaults extends ExecutionMutationDefaultPhases | undefined = undefined,
  StoredName extends string | undefined = undefined,
>(
  spec: FieldBuilderSpec<Type, Nullable, Many>,
  enumHandle?: Handle,
  executionDefaults?: ExecutionDefaults,
  storedName?: StoredName,
  generatorCalls?: FieldGeneratorCalls,
): FieldBuilder<Type, Nullable, Many, Handle, ExecutionDefaults, StoredName> {
  function many(): FieldBuilder<
    Type,
    Nullable,
    { readonly elementNullable: false },
    Handle,
    ExecutionDefaults,
    StoredName
  >;
  function many(options: {
    readonly elementsNullable: false;
  }): FieldBuilder<
    Type,
    Nullable,
    { readonly elementNullable: false },
    Handle,
    ExecutionDefaults,
    StoredName
  >;
  function many(options: {
    readonly elementsNullable: true;
  }): FieldBuilder<
    Type,
    Nullable,
    { readonly elementNullable: true },
    Handle,
    ExecutionDefaults,
    StoredName
  >;
  function many(options?: { readonly elementsNullable: boolean }) {
    return createFieldBuilder(
      {
        type: spec.type,
        nullable: spec.nullable,
        many: { elementNullable: options?.elementsNullable ?? false },
      },
      enumHandle,
      executionDefaults,
      storedName,
      generatorCalls,
    );
  }

  function withGeneratorCall<Phase extends GeneratorPhase>(
    phase: Phase,
    call: GeneratorFunctionCall,
  ) {
    if (generatorCalls?.[phase] !== undefined || executionDefaults?.[phase] !== undefined) {
      throw contractError(
        'CONTRACT.DEFAULT_INVALID',
        `.${phase}() is called on a field that already generates a value ${phase === 'onCreate' ? 'on create' : 'on update'}. Set each phase once, and do not combine .${phase}() with a type alias or alias constant that sets it.`,
        { meta: { reason: 'generator-phase-set-twice', phase } },
      );
    }
    return createFieldBuilder(
      spec,
      enumHandle,
      blindCast<
        WithGeneratedPhase<ExecutionDefaults, Phase>,
        'the phase is resolved from the call when the contract is built; the type records that it will be set'
      >(executionDefaults),
      storedName,
      { ...generatorCalls, [phase]: call },
    );
  }

  return {
    __kind: 'field',
    ...ifDefined('__executionDefaults', executionDefaults),
    ...ifDefined('__generatorCalls', generatorCalls),
    onCreate: (call) => withGeneratorCall('onCreate', call),
    onUpdate: (call) => withGeneratorCall('onUpdate', call),
    __type: spec.type,
    __nullable: spec.nullable,
    __many: spec.many,
    __enumHandle: blindCast<
      Handle,
      'optional param widens to Handle | undefined; Handle defaults to undefined when no enum handle is passed'
    >(enumHandle),
    __storedName: blindCast<
      StoredName,
      'optional param widens to StoredName | undefined; StoredName defaults to undefined when no stored name is passed'
    >(storedName),
    optional: () =>
      createFieldBuilder<Type, true, Many, Handle, ExecutionDefaults, StoredName>(
        {
          type: spec.type,
          nullable: true,
          many: spec.many,
        },
        enumHandle,
        executionDefaults,
        storedName,
        generatorCalls,
      ),
    many: blindCast<
      FieldBuilder<Type, Nullable, Many, Handle, ExecutionDefaults, StoredName>['many'],
      'every builder has the method at runtime, for a JavaScript caller the type does not stop; the type refuses it on a field a generator fills'
    >(many),
    mongo: <const Field extends string>({ field }: { readonly field: Field }) =>
      createFieldBuilder<Type, Nullable, Many, Handle, ExecutionDefaults, Field>(
        spec,
        enumHandle,
        executionDefaults,
        field,
        generatorCalls,
      ),
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
    type: blindCast<
      {
        readonly kind: 'scalar';
        readonly codecId: CodecId;
      } & ([TypeParams] extends [undefined] ? EmptyObject : { readonly typeParams: TypeParams }),
      'normalizeOptionalTypeParams adds typeParams exactly when TypeParams is not undefined'
    >({
      kind: 'scalar',
      codecId,
      ...normalizeOptionalTypeParams(options?.typeParams),
    }),
    nullable: false,
    many: false,
  });
}

type VectorFieldType = { readonly kind: 'scalar'; readonly codecId: 'mongo/vector@1' };

function vectorField(): FieldBuilder<VectorFieldType, false, false>;
function vectorField<const TypeParams extends Record<string, unknown>>(options: {
  readonly typeParams: TypeParams;
}): FieldBuilder<VectorFieldType & { readonly typeParams: TypeParams }, false, false>;
function vectorField(options?: { readonly typeParams: Record<string, unknown> }) {
  return createScalarFieldBuilder('mongo/vector@1', options);
}

export const field = refusingRemovedFieldPresets({
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
  int64() {
    return createScalarFieldBuilder('mongo/int64@1');
  },
  int64Number() {
    return createScalarFieldBuilder('mongo/int64Number@1');
  },
  decimal128() {
    return createScalarFieldBuilder('mongo/decimal128@1');
  },
  binary() {
    return createScalarFieldBuilder('mongo/binary@1');
  },
  json() {
    return createScalarFieldBuilder('mongo/json@1');
  },
  bson() {
    return createScalarFieldBuilder('mongo/bson@1');
  },
  vector: vectorField,
  valueObject<const ValueObject extends ValueObjectNameInput>(valueObjectName: ValueObject) {
    return createFieldBuilder({
      type: blindCast<
        {
          readonly kind: 'valueObject';
          readonly name: NormalizeValueObjectName<ValueObject>;
        },
        'resolveValueObjectName returns the normalized name the type computes'
      >({
        kind: 'valueObject',
        name: resolveValueObjectName(valueObjectName),
      }),
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
} as const);

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
    to: blindCast<
      NormalizeModelName<Target>,
      'resolveModelName returns the normalized name the type computes'
    >(targetModelName),
    cardinality,
    on: {
      localFields: blindCast<
        NormalizeStringList<From>,
        'normalizeStringList returns the normalized list the type computes'
      >(normalizeStringList(options.from)),
      targetFields: blindCast<
        NormalizeTargetFieldList<To>,
        'normalizeTargetFields returns the normalized list the type computes'
      >(normalizeTargetFields(targetModelName, options.to)),
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
    to: blindCast<
      NormalizeModelName<Target>,
      'resolveModelName returns the normalized name the type computes'
    >(resolveModelName(target)),
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
    __relations: blindCast<
      Relations extends Record<string, AnyRelationBuilder> ? Relations : Record<never, never>,
      'an omitted relations input is the empty record the type names'
    >(input.relations ?? {}),
    __indexes: input.indexes,
    __collectionOptions: input.collectionOptions,
    __controlPolicy: input.controlPolicy,
    __collection: blindCast<
      Collection,
      'the collection input carries the Collection type parameter'
    >(input.collection),
    __owner: blindCast<
      NormalizeModelNameOrUndefined<Owner>,
      'resolveModelName returns the normalized name the type computes'
    >(input.owner ? resolveModelName(input.owner) : undefined),
    __base: blindCast<
      NormalizeModelNameOrUndefined<Base>,
      'resolveModelName returns the normalized name the type computes'
    >(input.base ? resolveModelName(input.base) : undefined),
    __storageRelations: blindCast<
      StorageRelations,
      'the storageRelations input carries the StorageRelations type parameter'
    >(input.storageRelations),
    __discriminator: blindCast<
      Discriminator extends { readonly field: infer Field extends string }
        ? { readonly field: Field }
        : undefined,
      'the discriminator field is copied from the Discriminator input'
    >(input.discriminator ? { field: input.discriminator.field } : undefined),
    __variants: blindCast<
      Discriminator extends {
        readonly variants: infer Variants extends Record<string, VariantSpec>;
      }
        ? Variants
        : undefined,
      'the variants are copied from the Discriminator input'
    >(input.discriminator?.variants),
    ref(fieldName) {
      return createFieldReference(name, fieldName);
    },
  };
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

function buildContractFromDsl<const Input extends DslContractInput>(
  input: Input,
  lookups?: StackLookups,
): MongoContractResult<Input> {
  const definition = buildContractDefinition(input);
  const { codecLookup, dataTypes } =
    lookups ??
    stackLookupsOf([input.family, input.target, ...Object.values(input.extensions ?? {})]);
  const built = buildMongoContractFromDefinition(definition, codecLookup, dataTypes);
  flushAuthoringWarnings(
    (built.ok ? built.value.warnings : built.failure.warnings).map(authoringWarningOf),
  );
  if (!built.ok) {
    const [first] = built.failure.refusals;
    assertDefined(first, 'a refused build has at least one refusal');
    throw refusalError(first);
  }
  return blindCast<
    MongoContractResult<Input>,
    "the built contract's type erases the input's literal type parameters; MongoContractResult<Input> re-applies them so callers see the precise model/value-object/roots/namespace shapes"
  >(built.value.contract);
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

// Merges a bound input with the pre-bound family/target to produce a full ContractInput.
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
 * Overload 1: input form (no factory).
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
    const lookups = stackLookupsOf([family, target, ...Object.values(definition.extensions ?? {})]);
    const helpers = composeMongoAuthoringHelpers<F, T, NonNullable<Definition['extensions']>>(
      family,
      target,
      definition.extensions,
      lookups,
    );
    const built = factory(helpers);
    return buildContractFromDsl(
      {
        ...full,
        ...ifDefined('models', built.models),
        ...ifDefined('valueObjects', built.valueObjects),
        ...ifDefined('roots', built.roots),
      },
      lookups,
    );
  }

  return buildContractFromDsl(full);
}

export function defineContract<
  const Definition extends ContractInput<
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
    FamilyPackRef<string>,
    TargetPackRef<string, string>,
    Record<string, ExtensionPackRef<string, string>> | undefined,
    Record<string, ModelNameInput> | undefined
  >,
  const Built extends {
    readonly models?: Record<string, AnyModelBuilder>;
    readonly valueObjects?: Record<string, AnyValueObjectBuilder>;
    readonly roots?: Record<string, ModelNameInput> | undefined;
  },
>(
  definition: Definition,
  factory: (
    helpers: ContractAuthoringHelpers<
      Definition['family'],
      Definition['target'],
      ScaffoldExtensions<Definition>
    >,
  ) => Built,
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
