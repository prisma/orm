import type {
  ColumnDefault,
  Contract,
  ContractExecutionSection,
  ContractRelation,
  EnumMemberValueType,
  ExecutionMutationDefaultValue,
  FieldTypesFromDomain,
  JsonValue,
  NamespaceId,
  StorageHashBase,
} from '@internal/contract/types';
import type { ExtractParameterizedOutputTypesFromPack } from '@internal/contract-authoring';
import type {
  ExtensionPackRef,
  GeneratorPhase,
  TargetPackRef,
} from '@internal/framework-components/components';
import type { StorageType } from '@internal/framework-components/ir';
import type { IndexTypeRegistration } from '@internal/sql-contract/index-types';
import type {
  AggregateTypesFromDescriptors,
  ApplyQueryOperationTypes,
  AuthoredStorageTypeInstance,
  ColumnTypesFromStorage,
  ContractWithTypeMaps,
  ForeignKeyIndex,
  QueryOperationTypesFunction,
  ReferentialAction,
} from '@internal/sql-contract/types';
import type { UnionToIntersection } from './authoring-type-utils';
import type {
  AttributeStageIdFieldNames,
  FieldStateOf,
  IndexOptionsFunction,
  ScalarFieldBuilder,
} from './contract-dsl';
import type { EnumTypeHandle } from './enum-type';

export type PublicCodecTypes<CodecTypes extends Record<string, { readonly output: unknown }>> = {
  readonly [CodecId in keyof CodecTypes]: Pick<
    CodecTypes[CodecId],
    Extract<keyof CodecTypes[CodecId], 'input' | 'output' | 'traits' | 'keepsWrittenForm'>
  >;
};

export type ExtractCodecTypesFromPack<P> = P extends {
  __codecTypes?: infer C extends Record<string, { readonly output: unknown }>;
}
  ? PublicCodecTypes<C>
  : Record<never, never>;

export type MergeExtensionCodecTypes<Packs extends Record<string, unknown>> = UnionToIntersection<
  {
    [K in keyof Packs]: ExtractCodecTypesFromPack<Packs[K]>;
  }[keyof Packs]
>;

export type MergeExtensionCodecTypesSafe<Packs> =
  Packs extends Record<string, unknown>
    ? keyof Packs extends never
      ? Record<never, never>
      : MergeExtensionCodecTypes<Packs>
    : Record<never, never>;

export type ExtractIndexTypesFromPack<P> = P extends {
  readonly indexTypes: IndexTypeRegistration<infer M>;
}
  ? M
  : Record<never, never>;

type AllIndexTypeLiterals<Packs> =
  Packs extends Record<string, unknown>
    ? { [K in keyof Packs]: keyof ExtractIndexTypesFromPack<Packs[K]> }[keyof Packs] & string
    : never;

export type MergeExtensionIndexTypes<Packs extends Record<string, unknown>> = {
  readonly [Lit in AllIndexTypeLiterals<Packs>]: Extract<
    {
      [K in keyof Packs]: Lit extends keyof ExtractIndexTypesFromPack<Packs[K]>
        ? ExtractIndexTypesFromPack<Packs[K]>[Lit]
        : never;
    }[keyof Packs],
    { readonly options: unknown }
  >;
};

export type MergeExtensionPackRefs<
  Existing extends Record<string, unknown> | undefined,
  Added extends Record<string, ExtensionPackRef<'sql', string>>,
> = Existing extends Record<string, unknown> ? Existing & Added : Added;

type DefinitionExtensions<Definition> = Definition extends {
  readonly extensions?: infer Packs extends Record<string, ExtensionPackRef<'sql', string>>;
}
  ? Packs
  : Record<never, never>;

type ExtractPackCapabilities<P> = P extends {
  readonly capabilities?: infer Caps extends Record<string, Record<string, boolean>>;
}
  ? Caps
  : never;

type ExtensionCapabilityMatrices<Packs> =
  Packs extends Record<string, unknown>
    ? {
        [K in keyof Packs]: Defaulted<ExtractPackCapabilities<Packs[K]>, Record<never, never>>;
      }[keyof Packs]
    : never;

type KeysOfEach<T> = T extends unknown ? keyof T : never;

type NamespaceOfEach<Matrices, Namespace> = Matrices extends unknown
  ? Namespace extends keyof Matrices
    ? Matrices[Namespace]
    : never
  : never;

type FlagOfEach<Flags, Flag> = Flags extends unknown
  ? Flag extends keyof Flags
    ? Flags[Flag]
    : never
  : never;

// The extensions' flags, each `false` when two extensions set it differently: the runtime keeps the value of the extension listed last, an order the type of the extensions record does not carry.
type MergeExtensionPackCapabilities<Packs> = {
  readonly [Namespace in KeysOfEach<ExtensionCapabilityMatrices<Packs>>]: {
    readonly [Flag in KeysOfEach<
      NamespaceOfEach<ExtensionCapabilityMatrices<Packs>, Namespace>
    >]: FlagOfEach<
      NamespaceOfEach<ExtensionCapabilityMatrices<Packs>, Namespace>,
      Flag
    > extends true
      ? true
      : false;
  };
};

type Defaulted<T, Fallback> = [T] extends [never] ? Fallback : T;

type DefinitionAdapter<Definition> = Definition extends { readonly adapter?: infer Adapter }
  ? Present<Adapter>
  : never;

type EnabledCapabilityFlags<Flags> = {
  readonly [Flag in keyof Flags as Flags[Flag] extends true ? Flag : never]: true;
};

type EnabledCapabilities<Capabilities> = {
  readonly [Namespace in keyof Capabilities as keyof EnabledCapabilityFlags<
    Capabilities[Namespace]
  > extends never
    ? never
    : Namespace]: EnabledCapabilityFlags<Capabilities[Namespace]>;
};

// The flags of `Later` replace those of `Earlier` that it sets, namespace by namespace.
type OverrideCapabilities<Earlier, Later> = {
  readonly [Namespace in keyof Earlier | keyof Later]: Namespace extends keyof Later
    ? Namespace extends keyof Earlier
      ? Omit<Earlier[Namespace], keyof Later[Namespace]> & Later[Namespace]
      : Later[Namespace]
    : Namespace extends keyof Earlier
      ? Earlier[Namespace]
      : never;
};

// The enabled capabilities of the target, then its adapter, then the extensions, each replacing the flags it sets, as `prisma contract emit`, the build and the execution context merge them. A disabled capability is left out, as in an emitted contract.
type DerivedCapabilities<Definition> = EnabledCapabilities<
  OverrideCapabilities<
    OverrideCapabilities<
      Defaulted<ExtractPackCapabilities<DefinitionTarget<Definition>>, Record<never, never>>,
      Defaulted<ExtractPackCapabilities<DefinitionAdapter<Definition>>, Record<never, never>>
    >,
    MergeExtensionPackCapabilities<DefinitionExtensions<Definition>>
  >
>;

type ExtractQueryOperationTypesFromPack<
  P,
  CodecTypes extends Record<string, { readonly input: unknown; readonly output: unknown }>,
> = P extends { readonly __queryOperationTypes?: infer TypeFunction }
  ? Present<TypeFunction> extends infer Defined extends QueryOperationTypesFunction
    ? ApplyQueryOperationTypes<Defined, CodecTypes>
    : Record<never, never>
  : Record<never, never>;

type PackQueryOperationTypes<Definition> = UnionToIntersection<
  {
    [K in keyof AllPacks<Definition>]: ExtractQueryOperationTypesFromPack<
      AllPacks<Definition>[K],
      CodecTypesFromDefinition<Definition>
    >;
  }[keyof AllPacks<Definition>]
>;

type QueryOperationTypesFromDefinition<Definition> =
  PackQueryOperationTypes<Definition> extends infer Operations extends Record<string, unknown>
    ? Operations
    : Record<string, never>;

// A pack's aggregate descriptors, when their operations are literal; descriptors typed only as the general descriptor type name no operation the result types could key.
type PackAggregateDescriptors<Pack> = Pack extends { readonly types?: infer Types }
  ? Present<Types> extends { readonly aggregateDescriptors?: infer Descriptors }
    ? Present<Descriptors> extends ReadonlyArray<infer Descriptor>
      ? Descriptor extends { readonly operation: infer Operation }
        ? string extends Operation
          ? never
          : Descriptor
        : never
      : never
    : never
  : never;

type ExtensionAggregateDescriptors<Definition> = {
  [K in keyof DefinitionExtensions<Definition>]: PackAggregateDescriptors<
    DefinitionExtensions<Definition>[K]
  >;
}[keyof DefinitionExtensions<Definition>];

// The aggregate descriptors of the target, its adapter and the extensions, settled against the contract's codecs, as emission settles them.
type AggregateTypesFromDefinition<Definition> = AggregateTypesFromDescriptors<
  | PackAggregateDescriptors<DefinitionTarget<Definition>>
  | PackAggregateDescriptors<DefinitionAdapter<Definition>>
  | ExtensionAggregateDescriptors<Definition>,
  CodecTypesFromDefinition<Definition>
>;

type DefinitionTargetId<Definition> = Definition extends {
  readonly target: TargetPackRef<'sql', infer Target>;
}
  ? Target
  : never;

type Present<T> = Exclude<T, undefined>;

type CodecTypesFromDefinition<Definition> = ExtractCodecTypesFromPack<
  Definition extends { readonly target: infer Target } ? Target : never
> &
  MergeExtensionCodecTypesSafe<DefinitionExtensions<Definition>>;

type DefinitionTarget<Definition> = Definition extends { readonly target: infer Target }
  ? Target
  : never;

type AllPacks<Definition> = DefinitionExtensions<Definition> & {
  readonly __target: DefinitionTarget<Definition>;
};

export type IndexTypesFromDefinition<Definition> = MergeExtensionIndexTypes<AllPacks<Definition>>;

type DefinitionModels<Definition> = Definition extends {
  readonly models?: unknown;
}
  ? Present<Definition['models']> extends Record<string, unknown>
    ? Present<Definition['models']>
    : Record<never, never>
  : Record<never, never>;

type DefinitionNamespaces<Definition> = Definition extends {
  readonly namespaces?: infer Names extends readonly string[];
}
  ? string[] extends Names
    ? never
    : readonly string[] extends Names
      ? never
      : Names[number]
  : never;

type DefinitionTypes<Definition> = Definition extends {
  readonly databaseTypes?: unknown;
}
  ? Present<Definition['databaseTypes']> extends Record<string, StorageType>
    ? Present<Definition['databaseTypes']>
    : Record<never, never>
  : Record<never, never>;

type DefinitionTableNaming<Definition> = Definition extends {
  readonly naming?: { readonly tables?: infer Strategy extends string };
}
  ? Strategy
  : undefined;

type DefinitionColumnNaming<Definition> = Definition extends {
  readonly naming?: { readonly columns?: infer Strategy extends string };
}
  ? Strategy
  : undefined;

type FirstChar<S extends string> = S extends `${infer First}${string}` ? First : '';

type CharKind<C extends string> = C extends ''
  ? 'end'
  : C extends Lowercase<C>
    ? C extends Uppercase<C>
      ? 'other'
      : 'lower'
    : 'upper';

type ShouldInsertSnakeUnderscore<
  PrevKind extends 'start' | 'lower' | 'upper' | 'other' | 'end',
  Current extends string,
  Next extends string,
> =
  CharKind<Current> extends 'upper'
    ? PrevKind extends 'start'
      ? false
      : PrevKind extends 'lower' | 'other'
        ? true
        : CharKind<Next> extends 'lower'
          ? true
          : false
    : false;

type SnakeCaseInternal<
  S extends string,
  PrevKind extends 'start' | 'lower' | 'upper' | 'other' | 'end' = 'start',
> = S extends `${infer Current}${infer Rest}`
  ? `${ShouldInsertSnakeUnderscore<PrevKind, Current, FirstChar<Rest>> extends true
      ? '_'
      : ''}${Lowercase<Current>}${SnakeCaseInternal<Rest, CharKind<Current>>}`
  : '';

type SnakeCase<S extends string> = string extends S ? string : SnakeCaseInternal<S>;

type ApplyNamingType<Name extends string, Strategy extends string | undefined> = string extends Name
  ? string
  : Strategy extends 'snake_case'
    ? SnakeCase<Name>
    : Name;

type ModelNames<Definition> = keyof DefinitionModels<Definition> & string;

type ModelFields<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly stageOne: {
    readonly fields: Record<string, ScalarFieldBuilder>;
  };
}
  ? DefinitionModels<Definition>[ModelName]['stageOne']['fields']
  : Record<never, never>;

type ModelFieldNames<Definition, ModelName extends ModelNames<Definition>> = keyof ModelFields<
  Definition,
  ModelName
> &
  string;

type StagedModelRelations<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly stageOne: { readonly relations: infer R };
}
  ? R extends Record<string, unknown>
    ? R
    : Record<never, never>
  : Record<never, never>;

type StagedModelRelationNames<
  Definition,
  ModelName extends ModelNames<Definition>,
> = keyof StagedModelRelations<Definition, ModelName> & string;

type ModelFieldState<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends ModelFieldNames<Definition, ModelName>,
> = FieldStateOf<ModelFields<Definition, ModelName>[FieldName]>;

type ModelSql<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly __sql: infer SqlSpec;
}
  ? SqlSpec
  : undefined;

type ModelAttributes<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly __attributes: infer AttributesSpec;
}
  ? AttributesSpec
  : undefined;

type FieldDescriptorOf<FieldState> = Present<
  FieldState extends { readonly descriptor?: infer Descriptor } ? Descriptor : never
>;

type FieldEnumHandleOf<FieldState> = Present<
  FieldState extends { readonly enumHandle?: infer EnumHandle } ? EnumHandle : never
>;

type FieldNullableOf<FieldState> = FieldState extends {
  readonly nullable: infer Nullable extends boolean;
}
  ? Nullable
  : boolean;

type FieldManyOf<FieldState> = FieldState extends {
  readonly many: infer Many extends false | { readonly elementNullable: boolean };
}
  ? Many
  : false;

type FieldDefaultPresenceOf<FieldState> = Present<
  FieldState extends { readonly __defaultPresence?: infer Defaults } ? Defaults : never
>;

type FieldHasColumnDefault<FieldState> =
  FieldDefaultPresenceOf<FieldState> extends { readonly column: true } ? true : false;

type FieldGeneratesIn<FieldState, Phase extends GeneratorPhase> =
  FieldDefaultPresenceOf<FieldState> extends { readonly [K in Phase]: true } ? true : false;

type GeneratedPhaseKeys<FieldState> = (FieldGeneratesIn<FieldState, 'onCreate'> extends true
  ? { readonly onCreate: ExecutionMutationDefaultValue }
  : unknown) &
  (FieldGeneratesIn<FieldState, 'onUpdate'> extends true
    ? { readonly onUpdate: ExecutionMutationDefaultValue }
    : unknown);

type FieldColumnOverrideOf<FieldState> = Present<
  FieldState extends { readonly columnName?: infer ColumnName } ? ColumnName : never
>;

type FieldInlineIdSpecOf<FieldState> = Present<
  FieldState extends { readonly id?: infer IdSpec } ? IdSpec : never
>;

// A column spec types its `codecId` as `string`; the codec its factory builds carries the literal id.
type DescriptorCodecId<Descriptor> = Descriptor extends {
  readonly codecId: infer CodecId extends string;
}
  ? string extends CodecId
    ? ColumnSpecCodecId<Descriptor>
    : CodecId
  : string;

type ColumnSpecCodecId<Descriptor> = Descriptor extends {
  readonly codecFactory: (...args: never[]) => { readonly id: infer Id extends string };
}
  ? Id
  : string;

type DescriptorTypeParams<Descriptor> = Descriptor extends {
  readonly typeParams: infer TypeParams extends Record<string, unknown>;
}
  ? [keyof TypeParams] extends [never]
    ? undefined
    : TypeParams
  : undefined;

// The resolvers read an enum-typed field's codec straight off its handle. The
// `[...] extends [never]` guard excludes plain column fields, whose handle is
// `never`.
type EnumFieldHandle<FieldState> = [FieldEnumHandleOf<FieldState>] extends [never]
  ? never
  : FieldEnumHandleOf<FieldState> extends EnumTypeHandle
    ? FieldEnumHandleOf<FieldState>
    : never;

type EnumHandleDescriptor<Handle> = Handle extends {
  readonly codecId: infer CodecId extends string;
}
  ? { readonly codecId: CodecId }
  : never;

type ResolveFieldDescriptor<FieldState> = [EnumFieldHandle<FieldState>] extends [never]
  ? FieldDescriptorOf<FieldState>
  : EnumHandleDescriptor<EnumFieldHandle<FieldState>>;

type ResolveFieldColumnTypeParams<FieldState> = DescriptorTypeParams<FieldDescriptorOf<FieldState>>;

type ModelTableName<Definition, ModelName extends ModelNames<Definition>> = [
  Present<
    ModelSql<Definition, ModelName> extends { readonly table?: infer TableName } ? TableName : never
  >,
] extends [never]
  ? ApplyNamingType<ModelName, DefinitionTableNaming<Definition>>
  : Present<
        ModelSql<Definition, ModelName> extends { readonly table?: infer TableName }
          ? TableName
          : never
      > extends infer ExplicitTableName extends string
    ? ExplicitTableName
    : ApplyNamingType<ModelName, DefinitionTableNaming<Definition>>;

type ModelColumnName<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends ModelFieldNames<Definition, ModelName>,
> = [FieldColumnOverrideOf<ModelFieldState<Definition, ModelName, FieldName>>] extends [never]
  ? ApplyNamingType<FieldName, DefinitionColumnNaming<Definition>>
  : FieldColumnOverrideOf<
        ModelFieldState<Definition, ModelName, FieldName>
      > extends infer ExplicitColumnName extends string
    ? ExplicitColumnName
    : ApplyNamingType<FieldName, DefinitionColumnNaming<Definition>>;

type FieldNamesToColumnNames<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldNames extends readonly string[],
> = FieldNames extends readonly []
  ? readonly []
  : FieldNames extends readonly [
        infer First extends ModelFieldNames<Definition, ModelName>,
        ...infer Rest extends readonly string[],
      ]
    ? readonly [
        ModelColumnName<Definition, ModelName, First>,
        ...FieldNamesToColumnNames<Definition, ModelName, Rest>,
      ]
    : readonly string[];

type InlineIdFieldName<Definition, ModelName extends ModelNames<Definition>> = {
  [FieldName in ModelFieldNames<Definition, ModelName>]: [
    FieldInlineIdSpecOf<ModelFieldState<Definition, ModelName, FieldName>>,
  ] extends [never]
    ? never
    : FieldName;
}[ModelFieldNames<Definition, ModelName>];

type InlineIdFieldNames<Definition, ModelName extends ModelNames<Definition>> = [
  InlineIdFieldName<Definition, ModelName>,
] extends [never]
  ? undefined
  : readonly [InlineIdFieldName<Definition, ModelName>];

type InlineIdName<Definition, ModelName extends ModelNames<Definition>> = {
  [FieldName in ModelFieldNames<Definition, ModelName>]: FieldInlineIdSpecOf<
    ModelFieldState<Definition, ModelName, FieldName>
  > extends { readonly name?: infer Name extends string }
    ? Name
    : never;
}[ModelFieldNames<Definition, ModelName>];

type AttributeIdFieldNames<
  Definition,
  ModelName extends ModelNames<Definition>,
> = AttributeStageIdFieldNames<ModelAttributes<Definition, ModelName>>;

type AttributeIdName<Definition, ModelName extends ModelNames<Definition>> = Present<
  ModelAttributes<Definition, ModelName> extends {
    readonly id?: { readonly name?: infer Name extends string };
  }
    ? Name
    : never
>;

type ModelIdFieldNames<Definition, ModelName extends ModelNames<Definition>> = [
  AttributeIdFieldNames<Definition, ModelName>,
] extends [undefined]
  ? InlineIdFieldNames<Definition, ModelName>
  : AttributeIdFieldNames<Definition, ModelName>;

type ModelIdName<Definition, ModelName extends ModelNames<Definition>> = [
  AttributeIdName<Definition, ModelName>,
] extends [never]
  ? Present<InlineIdName<Definition, ModelName>>
  : AttributeIdName<Definition, ModelName>;

type StorageColumn<
  CodecId extends string,
  Nullable extends boolean,
  TypeParams extends Record<string, unknown> | undefined = undefined,
  Many extends false | { readonly elementNullable: boolean } = false,
  HasDefault extends boolean = false,
> = {
  readonly dataType: string;
  readonly codecId: CodecId;
  readonly nullable: Nullable;
} & (HasDefault extends true ? { readonly default: ColumnDefault } : Record<never, never>) &
  (TypeParams extends Record<string, unknown>
    ? { readonly typeParams: TypeParams }
    : Record<never, never>) & {
    readonly many: Many;
  };

type ModelStorageColumn<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends string,
> =
  FieldName extends ModelFieldNames<Definition, ModelName>
    ? StorageColumn<
        DescriptorCodecId<
          ResolveFieldDescriptor<ModelFieldState<Definition, ModelName, FieldName>>
        >,
        FieldNullableOf<ModelFieldState<Definition, ModelName, FieldName>>,
        ResolveFieldColumnTypeParams<ModelFieldState<Definition, ModelName, FieldName>>,
        FieldManyOf<ModelFieldState<Definition, ModelName, FieldName>>,
        FieldHasColumnDefault<ModelFieldState<Definition, ModelName, FieldName>>
      >
    : never;

type StagedRelationState<
  Definition,
  ModelName extends ModelNames<Definition>,
  RelName extends StagedModelRelationNames<Definition, ModelName>,
> = StagedModelRelations<Definition, ModelName>[RelName] extends { readonly __state: infer State }
  ? State
  : never;

type RelationSourceModelName<Source> = Source extends {
  readonly modelName: infer Name extends string;
}
  ? Name
  : Source extends { readonly resolve: () => infer Name extends string }
    ? Name
    : never;

type RelationFieldTuple<Fields> = Fields extends readonly string[]
  ? Fields
  : readonly [Extract<Fields, string>];

type RelationFieldUnion<Fields> = Fields extends readonly (infer FieldName)[] ? FieldName : Fields;

type ModelAnchorFieldNames<Definition, ModelName extends ModelNames<Definition>> =
  ModelIdFieldNames<Definition, ModelName> extends infer IdFields extends readonly string[]
    ? IdFields
    : readonly ['id'];

type AnyFieldNullable<Definition, ModelName extends ModelNames<Definition>, Fields> = true extends (
  RelationFieldUnion<Fields> extends infer FieldName
    ? FieldName extends ModelFieldNames<Definition, ModelName>
      ? FieldNullableOf<ModelFieldState<Definition, ModelName, FieldName>>
      : boolean
    : never
)
  ? true
  : false;

// A declared `optional` that disagrees with the `from` fields fails the build, so the fields decide.
type BelongsToNullable<
  Definition,
  ModelName extends ModelNames<Definition>,
  State,
> = AnyFieldNullable<
  Definition,
  ModelName,
  State extends { readonly from: infer From } ? From : never
>;

type BuiltRelationTarget<Definition, Target extends ModelNames<Definition>> = {
  readonly namespace: ModelNamespace<Definition, Target> & NamespaceId;
  readonly model: Target;
};

// The target's primary key columns, or the columns of its unique key when it has no primary key, as the build picks them.
type JunctionTargetColumns<Definition, Target extends ModelNames<Definition>> =
  ModelIdFieldNames<Definition, Target> extends infer IdFields extends readonly string[]
    ? FieldNamesToColumnNames<Definition, Target, IdFields>
    : BuiltUnique<Definition, Target>['columns'];

type BuiltManyToManyRelation<
  Definition,
  ModelName extends ModelNames<Definition>,
  Target extends ModelNames<Definition>,
  State,
> = State extends {
  readonly through: infer ThroughSource;
  readonly from: infer From;
  readonly to: infer To;
}
  ? RelationSourceModelName<ThroughSource> extends infer Through extends ModelNames<Definition>
    ? {
        readonly to: BuiltRelationTarget<Definition, Target>;
        readonly cardinality: 'N:M';
        readonly on: {
          readonly localFields: ModelAnchorFieldNames<Definition, ModelName>;
          readonly targetFields: FieldNamesToColumnNames<
            Definition,
            Through,
            RelationFieldTuple<From>
          >;
        };
        readonly through: {
          readonly table: ModelTableName<Definition, Through>;
          readonly namespaceId: ModelNamespace<Definition, Through>;
          readonly parentColumns: FieldNamesToColumnNames<
            Definition,
            Through,
            RelationFieldTuple<From>
          >;
          readonly childColumns: FieldNamesToColumnNames<
            Definition,
            Through,
            RelationFieldTuple<To>
          >;
          readonly targetColumns: JunctionTargetColumns<Definition, Target>;
        };
      }
    : ContractRelation
  : ContractRelation;

type BuiltSameSpaceRelationByKind<
  Definition,
  ModelName extends ModelNames<Definition>,
  Target extends ModelNames<Definition>,
  State,
> = State extends { readonly kind: 'belongsTo'; readonly from: infer From; readonly to: infer To }
  ? {
      readonly to: BuiltRelationTarget<Definition, Target>;
      readonly cardinality: 'N:1';
      readonly nullable: BelongsToNullable<Definition, ModelName, State>;
      readonly on: {
        readonly localFields: RelationFieldTuple<From>;
        readonly targetFields: RelationFieldTuple<To>;
      };
    }
  : State extends { readonly kind: 'hasMany'; readonly by: infer By }
    ? {
        readonly to: BuiltRelationTarget<Definition, Target>;
        readonly cardinality: '1:N';
        readonly on: {
          readonly localFields: ModelAnchorFieldNames<Definition, ModelName>;
          readonly targetFields: RelationFieldTuple<By>;
        };
      }
    : State extends { readonly kind: 'hasOne'; readonly by: infer By }
      ? {
          readonly to: BuiltRelationTarget<Definition, Target>;
          readonly cardinality: '1:1';
          readonly nullable: true;
          readonly on: {
            readonly localFields: ModelAnchorFieldNames<Definition, ModelName>;
            readonly targetFields: RelationFieldTuple<By>;
          };
        }
      : State extends { readonly kind: 'manyToMany' }
        ? BuiltManyToManyRelation<Definition, ModelName, Target, State>
        : ContractRelation;

type IsOtherSpaceTarget<State> = State extends { readonly __targetSpaceId?: infer SpaceId }
  ? [Present<SpaceId>] extends ['<self>']
    ? false
    : true
  : false;

// A relation to a model in another contract space keeps the general type, whatever the target's name.
type BuiltRelation<Definition, ModelName extends ModelNames<Definition>, State> =
  IsOtherSpaceTarget<State> extends true
    ? ContractRelation
    : BuiltSameSpaceRelation<Definition, ModelName, State>;

type BuiltSameSpaceRelation<
  Definition,
  ModelName extends ModelNames<Definition>,
  State,
> = State extends {
  readonly toModel: infer Source;
}
  ? RelationSourceModelName<Source> extends infer Target extends ModelNames<Definition>
    ? BuiltSameSpaceRelationByKind<Definition, ModelName, Target, State>
    : ContractRelation
  : ContractRelation;

type ExecutionDefaultEntries<Definition> = {
  [ModelName in ModelNames<Definition>]: {
    [FieldName in ModelFieldNames<Definition, ModelName>]: true extends
      | FieldGeneratesIn<ModelFieldState<Definition, ModelName, FieldName>, 'onCreate'>
      | FieldGeneratesIn<ModelFieldState<Definition, ModelName, FieldName>, 'onUpdate'>
      ? ContractExecutionSection['mutations']['defaults'][number] &
          GeneratedPhaseKeys<ModelFieldState<Definition, ModelName, FieldName>> & {
            readonly ref: {
              readonly namespace: ModelNamespace<Definition, ModelName>;
              readonly entry: ModelTableName<Definition, ModelName>;
              readonly field: ModelColumnName<Definition, ModelName, FieldName>;
            };
          }
      : never;
  }[ModelFieldNames<Definition, ModelName>];
}[ModelNames<Definition>];

type BuiltExecution<Definition> = [ExecutionDefaultEntries<Definition>] extends [never]
  ? { readonly execution?: ContractExecutionSection }
  : {
      readonly execution: ContractExecutionSection & {
        readonly mutations: {
          readonly defaults: ReadonlyArray<ExecutionDefaultEntries<Definition>>;
        };
      };
    };

type DomainFieldTypeParams<TypeParams> =
  TypeParams extends Record<string, unknown>
    ? keyof TypeParams extends never
      ? Record<never, never>
      : { readonly typeParams: TypeParams }
    : Record<never, never>;

type DomainFieldMany<Many> = Many extends false ? Record<never, never> : { readonly many: Many };

type BuiltModels<Definition> = {
  readonly [ModelName in ModelNames<Definition>]: {
    readonly storage: {
      readonly table: ModelTableName<Definition, ModelName>;
      readonly namespaceId: ModelNamespace<Definition, ModelName>;
      readonly fields: {
        readonly [FieldName in ModelFieldNames<Definition, ModelName>]: {
          readonly column: ModelColumnName<Definition, ModelName, FieldName>;
        };
      };
    };
    readonly fields: {
      readonly [FieldName in ModelFieldNames<Definition, ModelName>]: {
        readonly nullable: ModelStorageColumn<Definition, ModelName, FieldName>['nullable'];
        readonly type: {
          readonly kind: 'scalar';
          readonly codecId: ModelStorageColumn<Definition, ModelName, FieldName>['codecId'];
        } & DomainFieldTypeParams<
          FieldColumnTypeParams<ModelFieldState<Definition, ModelName, FieldName>>
        >;
      } & DomainFieldMany<FieldManyOf<ModelFieldState<Definition, ModelName, FieldName>>>;
    };
    readonly relations: {
      readonly [RelName in StagedModelRelationNames<Definition, ModelName>]: BuiltRelation<
        Definition,
        ModelName,
        StagedRelationState<Definition, ModelName, RelName>
      >;
    };
  };
};

type BuiltModelColumnMappings<
  Definition,
  ModelName extends ModelNames<Definition>,
> = BuiltModels<Definition>[ModelName]['storage']['fields'];

type BuiltModelTableName<
  Definition,
  ModelName extends ModelNames<Definition>,
> = BuiltModels<Definition>[ModelName]['storage']['table'];

type BuiltStorageTableColumns<Definition, ModelName extends ModelNames<Definition>> = {
  readonly [FieldName in keyof BuiltModelColumnMappings<Definition, ModelName> &
    string as BuiltModelColumnMappings<
    Definition,
    ModelName
  >[FieldName]['column']]: ModelStorageColumn<Definition, ModelName, FieldName>;
};

type FieldUniqueSpecOf<FieldState> = FieldState extends { readonly unique: infer UniqueSpec }
  ? [UniqueSpec] extends [{ readonly name?: infer Name }]
    ? { readonly name: Name }
    : never
  : never;

type UniqueName<Name> = Present<Name> extends infer Defined extends string ? Defined : never;

type InlineUnique<Definition, ModelName extends ModelNames<Definition>> = {
  [FieldName in ModelFieldNames<Definition, ModelName>]: FieldUniqueSpecOf<
    ModelFieldState<Definition, ModelName, FieldName>
  > extends infer Spec
    ? [Spec] extends [never]
      ? never
      : Spec extends { readonly name: infer Name }
        ? {
            readonly columns: readonly [ModelColumnName<Definition, ModelName, FieldName>];
            readonly name?: UniqueName<Name>;
          }
        : never
    : never;
}[ModelFieldNames<Definition, ModelName>];

type AttributeUnique<Definition, ModelName extends ModelNames<Definition>> =
  ModelAttributes<Definition, ModelName> extends {
    readonly uniques?: infer Uniques extends readonly unknown[];
  }
    ? Uniques[number] extends infer Unique
      ? Unique extends {
          readonly fields: infer Fields extends readonly string[];
        }
        ? number extends Fields['length']
          ? never
          : {
              readonly columns: FieldNamesToColumnNames<Definition, ModelName, Fields>;
              readonly name?: Unique extends { readonly name?: infer Name }
                ? UniqueName<Name>
                : never;
            }
        : never
      : never
    : never;

// The unique constraints of a model, from `.unique()` fields and the `uniques` attribute, so a unique criterion names their columns.
type BuiltUnique<Definition, ModelName extends ModelNames<Definition>> =
  | InlineUnique<Definition, ModelName>
  | AttributeUnique<Definition, ModelName>;

type JoinColumns<Columns> = Columns extends readonly [infer Only extends string]
  ? Only
  : Columns extends readonly [infer First extends string, ...infer Rest]
    ? `${First}_${JoinColumns<Rest>}`
    : string;

type SameColumns<A, B> = [A] extends [B] ? ([B] extends [A] ? true : false) : false;

type ModelColumnOf<Definition, ModelName extends ModelNames<Definition>> = {
  readonly [FieldName in ModelFieldNames<Definition, ModelName>]: ModelColumnName<
    Definition,
    ModelName,
    FieldName
  >;
};

type DeclaredIndexConstraints<Definition, ModelName extends ModelNames<Definition>> =
  ModelSql<Definition, ModelName> extends {
    readonly indexes?: infer Indexes extends readonly unknown[];
  }
    ? Indexes
    : readonly [];

// An index constraint's type is a union of its arms (fields or expression, with or without a type), so each reading below takes the whole constraint rather than distributing over the arms.
type IndexColumns<Definition, ModelName extends ModelNames<Definition>, Constraint> = [
  Constraint,
] extends [{ readonly fields?: infer Fields }]
  ? Present<Fields> extends infer Defined extends readonly string[]
    ? [Defined] extends [never]
      ? readonly []
      : number extends Defined['length']
        ? readonly string[]
        : FieldNamesToColumnNames<Definition, ModelName, Defined>
    : readonly []
  : readonly [];

type IndexSpecOfConstraint<Constraint> = [Constraint] extends [{ readonly __spec?: infer Spec }]
  ? Present<Spec>
  : never;

type IndexMapOf<Constraint> =
  IndexSpecOfConstraint<Constraint> extends {
    readonly map: infer Map extends string;
  }
    ? Map
    : never;

type IndexNameOf<Constraint> = [Constraint] extends [{ readonly name?: infer Name }]
  ? Present<Name> extends infer Defined extends string
    ? Defined
    : never
  : never;

// How the build names an index: a `map:` name verbatim, otherwise a wire name whose prefix is the authored `name:` or the default `<table>_<columns>_idx`. Code reads an index by its `map:` name or its prefix.
type IndexNaming<Definition, ModelName extends ModelNames<Definition>, Constraint> = [
  IndexMapOf<Constraint>,
] extends [never]
  ? {
      readonly name: string;
      readonly prefix: [IndexNameOf<Constraint>] extends [never]
        ? `${ModelTableName<Definition, ModelName>}_${JoinColumns<IndexColumns<Definition, ModelName, Constraint>>}_idx`
        : IndexNameOf<Constraint>;
    }
  : { readonly name: IndexMapOf<Constraint> };

type IndexMethod<Definition, ModelName extends ModelNames<Definition>, Constraint> = [
  IndexSpecOfConstraint<Constraint>,
] extends [never]
  ? Record<never, never>
  : IndexMethodOfSpec<Definition, ModelName, IndexSpecOfConstraint<Constraint>>;

type IndexMethodOfSpec<Definition, ModelName extends ModelNames<Definition>, Spec> = (Spec extends {
  readonly type: infer Type extends string;
}
  ? { readonly type: Type }
  : Record<never, never>) &
  (Spec extends { readonly options: infer Options }
    ? [Options] extends [undefined]
      ? Record<never, never>
      : {
          readonly options: Options extends IndexOptionsFunction
            ? (Options & { readonly columnOf: ModelColumnOf<Definition, ModelName> })['options']
            : Options;
        }
    : Record<never, never>);

type BuiltDeclaredIndexOf<
  Definition,
  ModelName extends ModelNames<Definition>,
  Constraint,
> = IndexNaming<Definition, ModelName, Constraint> & {
  readonly columns: IndexColumns<Definition, ModelName, Constraint>;
  readonly unique: boolean;
} & IndexMethod<Definition, ModelName, Constraint>;

type BuiltDeclaredIndexesOf<
  Definition,
  ModelName extends ModelNames<Definition>,
  Constraints extends readonly unknown[],
> = {
  readonly [K in keyof Constraints]: BuiltDeclaredIndexOf<Definition, ModelName, Constraints[K]>;
}[number];

type BuiltDeclaredIndex<
  Definition,
  ModelName extends ModelNames<Definition>,
> = BuiltDeclaredIndexesOf<Definition, ModelName, DeclaredIndexConstraints<Definition, ModelName>>;

type DefaultForeignKeyIndex<Definition> = Definition extends {
  readonly foreignKeyDefaults?: infer Defaults;
}
  ? [Present<Defaults>] extends [never]
    ? true
    : Present<Defaults> extends { readonly index: false }
      ? false
      : true
  : true;

// Whether a foreign key gets a derived backing index: `index: false` or the name of a declared object gives none, and an unstated intent follows the contract's foreign key defaults.
type DerivesBackingIndex<Definition, Intent> = [Present<Intent>] extends [never]
  ? DefaultForeignKeyIndex<Definition>
  : Present<Intent> extends false
    ? false
    : Present<Intent> extends true
      ? true
      : Present<Intent> extends string
        ? string extends Present<Intent>
          ? DefaultForeignKeyIndex<Definition>
          : false
        : DefaultForeignKeyIndex<Definition>;

// The `fk` of a relation's `.sql(...)`, or `never` when the relation declares none.
type RelationForeignKey<RelationSql> = [Present<RelationSql>] extends [never]
  ? never
  : Present<RelationSql> extends { readonly fk?: infer ForeignKey }
    ? Present<ForeignKey>
    : never;

type ModelForeignKeyFields<Definition, ModelName extends ModelNames<Definition>> =
  | (ModelSql<Definition, ModelName> extends {
      readonly foreignKeys?: infer ForeignKeys extends readonly unknown[];
    }
      ? ForeignKeys[number] extends infer ForeignKey
        ? ForeignKey extends { readonly fields: infer Fields extends readonly string[] }
          ? DerivesBackingIndex<
              Definition,
              ForeignKey extends { readonly index?: infer Intent } ? Intent : undefined
            > extends true
            ? Fields
            : never
          : never
        : never
      : never)
  | {
      [RelName in StagedModelRelationNames<Definition, ModelName>]: StagedRelationState<
        Definition,
        ModelName,
        RelName
      > extends {
        readonly kind: 'belongsTo';
        readonly from: infer From;
        readonly sql?: infer RelationSql;
      }
        ? RelationForeignKey<RelationSql> extends infer ForeignKey
          ? [ForeignKey] extends [never]
            ? never
            : DerivesBackingIndex<
                  Definition,
                  ForeignKey extends { readonly index?: infer Intent } ? Intent : undefined
                > extends true
              ? RelationFieldTuple<From>
              : never
          : never
        : never;
    }[StagedModelRelationNames<Definition, ModelName>];

// The build drops a derived backing index that the primary key, a unique constraint or a declared index on the same columns already serves.
type BackingIndexIsRedundant<
  Definition,
  ModelName extends ModelNames<Definition>,
  Columns,
> = true extends
  | SameColumns<
      Columns,
      ModelIdFieldNames<Definition, ModelName> extends infer IdFields extends readonly string[]
        ? FieldNamesToColumnNames<Definition, ModelName, IdFields>
        : never
    >
  | (BuiltUnique<Definition, ModelName> extends infer Unique
      ? Unique extends { readonly columns: infer UniqueColumns }
        ? SameColumns<Columns, UniqueColumns>
        : never
      : never)
  | (PlainDeclaredIndexColumns<Definition, ModelName> extends infer DeclaredColumns
      ? DeclaredColumns extends unknown
        ? SameColumns<Columns, DeclaredColumns>
        : never
      : never)
  ? true
  : false;

// The columns of each declared index that serves a backing index's lookups, as the build decides: no predicate, no type and no options. A partial, typed or other index leaves the backing index in place.
type PlainDeclaredIndexColumnsOf<
  Definition,
  ModelName extends ModelNames<Definition>,
  Constraints extends readonly unknown[],
> = {
  readonly [K in keyof Constraints]: IndexSpecOfConstraint<Constraints[K]> extends {
    readonly type: undefined;
    readonly options: undefined;
    readonly partial: false;
  }
    ? IndexColumns<Definition, ModelName, Constraints[K]>
    : never;
}[number];

type PlainDeclaredIndexColumns<
  Definition,
  ModelName extends ModelNames<Definition>,
> = PlainDeclaredIndexColumnsOf<
  Definition,
  ModelName,
  DeclaredIndexConstraints<Definition, ModelName>
>;

type AsciiCharacter =
  | ' '
  | '!'
  | '"'
  | '#'
  | '$'
  | '%'
  | '&'
  | "'"
  | '('
  | ')'
  | '*'
  | '+'
  | ','
  | '-'
  | '.'
  | '/'
  | '0'
  | '1'
  | '2'
  | '3'
  | '4'
  | '5'
  | '6'
  | '7'
  | '8'
  | '9'
  | ':'
  | ';'
  | '<'
  | '='
  | '>'
  | '?'
  | '@'
  | 'A'
  | 'B'
  | 'C'
  | 'D'
  | 'E'
  | 'F'
  | 'G'
  | 'H'
  | 'I'
  | 'J'
  | 'K'
  | 'L'
  | 'M'
  | 'N'
  | 'O'
  | 'P'
  | 'Q'
  | 'R'
  | 'S'
  | 'T'
  | 'U'
  | 'V'
  | 'W'
  | 'X'
  | 'Y'
  | 'Z'
  | '['
  | '\\'
  | ']'
  | '^'
  | '_'
  | '`'
  | 'a'
  | 'b'
  | 'c'
  | 'd'
  | 'e'
  | 'f'
  | 'g'
  | 'h'
  | 'i'
  | 'j'
  | 'k'
  | 'l'
  | 'm'
  | 'n'
  | 'o'
  | 'p'
  | 'q'
  | 'r'
  | 's'
  | 't'
  | 'u'
  | 'v'
  | 'w'
  | 'x'
  | 'y'
  | 'z'
  | '{'
  | '|'
  | '}'
  | '~';

/**
 * A derived wire-name prefix as the build shortens it: to its first 54 bytes (`WIRE_NAME_PREFIX_MAX_BYTES`). Each ASCII character is one byte. A name with another character before the cut has a byte length the type does not count, so it gives `never` and the index has no name in the type.
 */
type DerivedWireNamePrefix<
  Name extends string,
  Kept extends string = '',
  Bytes extends readonly unknown[] = [],
> = string extends Name
  ? string
  : Bytes['length'] extends 54
    ? Kept
    : Name extends `${infer Character}${infer Rest}`
      ? Character extends AsciiCharacter
        ? DerivedWireNamePrefix<Rest, `${Kept}${Character}`, [...Bytes, unknown]>
        : never
      : Kept;

type BuiltBackingIndex<Definition, ModelName extends ModelNames<Definition>> =
  ModelForeignKeyFields<Definition, ModelName> extends infer Fields
    ? Fields extends readonly string[]
      ? FieldNamesToColumnNames<Definition, ModelName, Fields> extends infer Columns
        ? BackingIndexIsRedundant<Definition, ModelName, Columns> extends true
          ? never
          : {
              readonly name: string;
              readonly prefix: DerivedWireNamePrefix<`${ModelTableName<Definition, ModelName>}_${JoinColumns<Columns>}_idx`>;
              readonly columns: Columns;
              readonly unique: false;
            }
        : never
      : never
    : never;

// A table's indexes: those `.sql({ indexes })` declares, and the backing indexes the build derives for its foreign keys, named as the build names them, so code can read each by the name it was given.
type BuiltIndex<Definition, ModelName extends ModelNames<Definition>> =
  | BuiltDeclaredIndex<Definition, ModelName>
  | BuiltBackingIndex<Definition, ModelName>;

type BuiltStorageTables<Definition, Ns extends string> = {
  readonly [ModelName in ModelsInNamespace<Definition, Ns> as BuiltModelTableName<
    Definition,
    ModelName
  >]: {
    readonly columns: BuiltStorageTableColumns<Definition, ModelName>;
    readonly uniques: ReadonlyArray<BuiltUnique<Definition, ModelName>>;
    readonly indexes: ReadonlyArray<BuiltIndex<Definition, ModelName>>;
    readonly foreignKeys: ReadonlyArray<{
      readonly source: {
        readonly namespaceId: NamespaceId;
        readonly tableName: string;
        readonly columns: readonly string[];
      };
      readonly target: {
        readonly namespaceId: NamespaceId;
        readonly spaceId?: string;
        readonly tableName: string;
        readonly columns: readonly string[];
      };
      readonly name?: string;
      readonly onDelete?: ReferentialAction;
      readonly onUpdate?: ReferentialAction;
      readonly index?: ForeignKeyIndex;
    }>;
  } & (ModelIdFieldNames<Definition, ModelName> extends readonly string[]
    ? {
        readonly primaryKey: {
          readonly columns: FieldNamesToColumnNames<
            Definition,
            ModelName,
            ModelIdFieldNames<Definition, ModelName>
          >;
          readonly name?: ModelIdName<Definition, ModelName>;
        };
      }
    : Record<never, never>);
};

type DefinitionEnums<Definition> = Definition extends {
  readonly enums?: infer E;
}
  ? Present<E> extends Record<string, EnumTypeHandle>
    ? // A bare `Record<string, EnumTypeHandle>` (no literal keys) is the
      // widened default for a contract authored without enums; treat it as
      // empty so `db.enums` carries only literally-authored enums.
      string extends keyof Present<E>
      ? Record<never, never>
      : Present<E>
    : Record<never, never>
  : Record<never, never>;

type BuiltDocumentScopedTypes<Definition> = {
  readonly [K in keyof DefinitionTypes<Definition> as DefinitionTypes<Definition>[K] extends AuthoredStorageTypeInstance
    ? K
    : never]: DefinitionTypes<Definition>[K] & { readonly dataType: string };
};

type BuiltDomain<Definition> =
  BuiltDocumentScopedTypes<Definition> extends Record<never, never>
    ? Record<never, never>
    : {
        readonly __unbound__: {
          readonly types: BuiltDocumentScopedTypes<Definition>;
        };
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

// The storage `valueSet` entries for enums authored with `enumType`: each enum's member values as they are stored.
type EnumHandleValueSets<Enums> = {
  readonly [K in keyof Enums as HandleName<Enums[K]>]: {
    readonly kind: 'valueSet';
    readonly values: Enums[K] extends EnumTypeHandle<string, infer Values>
      ? { readonly [I in keyof Values]: StoredEnumValue<Values[I]> }
      : never;
  };
};

type DefinitionHasEnums<Definition> = keyof DefinitionEnums<Definition> extends never
  ? false
  : true;

// Authored enums are registered in the default namespace, whatever namespace the fields that use them are in.
type HoldsDefinitionEnums<Definition, Ns extends string> =
  DefinitionHasEnums<Definition> extends true
    ? Ns extends DefaultStorageNamespaceId<Definition>
      ? true
      : false
    : false;

type BuiltDomainNamespace<Definition, Ns extends string> = {
  readonly models: {
    readonly [ModelName in ModelsInNamespace<Definition, Ns>]: BuiltModels<Definition>[ModelName];
  };
} & (HoldsDefinitionEnums<Definition, Ns> extends true
  ? {
      readonly enum: EnumHandleEntries<DefinitionEnums<Definition>>;
      readonly enumMemberTypes?: EnumHandleMemberTypes<
        DefinitionEnums<Definition>,
        CodecTypesFromDefinition<Definition>
      >;
    }
  : Record<never, never>);

type DefaultStorageNamespaceId<Definition> =
  DefinitionTarget<Definition> extends {
    readonly defaultNamespaceId: infer Id extends string;
  }
    ? Id
    : never;

type ModelNamespaceOf<Definition, Namespace> = [Namespace] extends [undefined]
  ? DefaultStorageNamespaceId<Definition>
  : Namespace extends '' | undefined
    ? DefaultStorageNamespaceId<Definition>
    : Namespace;

type ModelNamespace<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly __namespace: infer Namespace extends string | undefined;
}
  ? ModelNamespaceOf<Definition, Namespace>
  : DefaultStorageNamespaceId<Definition>;

type ModelNamespaces<Definition> = {
  [ModelName in ModelNames<Definition>]: ModelNamespace<Definition, ModelName>;
}[ModelNames<Definition>] &
  string;

// A model whose namespace is a non-literal `string` cannot be placed, so every namespace lists every model.
type ModelsInNamespace<Definition, Ns extends string> =
  string extends ModelNamespaces<Definition>
    ? ModelNames<Definition>
    : {
        [ModelName in ModelNames<Definition>]: Ns extends ModelNamespace<Definition, ModelName>
          ? ModelName
          : never;
      }[ModelNames<Definition>];

// Mirrors the namespaces `buildSqlContractFromDefinition` puts in `domain.namespaces`: each
// model's namespace, and the default namespace when the contract has no models or has enums.
type DomainNamespaceIds<Definition> = (
  | ModelNamespaces<Definition>
  | ([ModelNames<Definition>] extends [never] ? DefaultStorageNamespaceId<Definition> : never)
  | (keyof DefinitionEnums<Definition> extends never
      ? never
      : DefaultStorageNamespaceId<Definition>)
) &
  string;

type StorageNamespaceIds<Definition> = (
  | DefaultStorageNamespaceId<Definition>
  | DefinitionNamespaces<Definition>
  | ModelNamespaces<Definition>
) &
  string;

type BuiltStorage<Definition> = {
  readonly storageHash: StorageHashBase<string>;
  readonly types?: BuiltDocumentScopedTypes<Definition>;
  // The shape is described inline (rather than intersecting with
  // `SqlStorage['namespaces']`) so its `Readonly<Record<string, Namespace>>`
  // index signature doesn't collapse slot keys to `string`. The literal object
  // is still structurally assignable to `SqlStorage['namespaces']` because
  // every value satisfies the framework `Namespace` interface.
  readonly namespaces: {
    readonly [Ns in StorageNamespaceIds<Definition>]: {
      readonly id: Ns;
      readonly kind: string;
      readonly entries: {
        readonly table: BuiltStorageTables<Definition, Ns>;
      } & (HoldsDefinitionEnums<Definition, Ns> extends true
        ? { readonly valueSet: EnumHandleValueSets<DefinitionEnums<Definition>> }
        : Record<never, never>);
    };
  };
};

// The enum value union for an enum-typed field, or `never` for a non-enum
// field. The field carries the authored `EnumTypeHandle`, whose
// `Values` tuple preserves the literal member values (text or numeric).
type EnumValueUnion<FieldState> = [FieldEnumHandleOf<FieldState>] extends [
  EnumTypeHandle<string, infer Values>,
]
  ? readonly unknown[] extends Values
    ? never
    : Values[number]
  : never;

// The member-value literal tuple carried on a descriptor's `entityRef.entity`
// (e.g. a target's native-enum entity), or `never` when the descriptor has no
// entityRef, its entity has no `members`, or `members` is widened to
// `readonly string[]` — this is checked with non-optional property shapes so
// a descriptor genuinely lacking `entityRef` fails the structural match
// instead of matching vacuously through the framework type's optional slot.
type DescriptorEntityMembers<Descriptor> = Descriptor extends {
  readonly entityRef: {
    readonly entity: { readonly members: infer Members extends readonly string[] };
  };
}
  ? Members
  : never;

// The value-set member union for a descriptor-carried entity (the type-level
// mirror of the runtime's generic `deriveValueSetFromEntity` fold), or
// `never` for a field with no descriptor, a descriptor with no entityRef.entity,
// or a widened (non-literal) members tuple — mirroring `EnumValueUnion`'s
// erasure guard.
type DescriptorValueSetUnion<FieldState> = [FieldDescriptorOf<FieldState>] extends [never]
  ? never
  : readonly string[] extends DescriptorEntityMembers<FieldDescriptorOf<FieldState>>
    ? never
    : DescriptorEntityMembers<FieldDescriptorOf<FieldState>>[number];

type FieldColumnTypeParams<FieldState> = DescriptorTypeParams<FieldDescriptorOf<FieldState>>;

type ParameterizedOutputTypesFromDefinition<Definition> = {
  [K in keyof AllPacks<Definition>]: ExtractParameterizedOutputTypesFromPack<
    AllPacks<Definition>[K]
  >;
}[keyof AllPacks<Definition>];

// The value type of the codec a column spec's factory builds, such as the type an arktype schema infers; `never` for a descriptor without a factory.
type ColumnSpecCodecOutput<Descriptor> = Descriptor extends {
  readonly codecFactory: (...args: never[]) => infer Codec;
}
  ? Codec extends { fromWire(...args: never[]): Promise<infer Output> }
    ? Output
    : never
  : never;

// The literal value union for a field: the enum-typed union takes precedence
// (matching today's behavior), falling back to the descriptor-carried
// value-set union; `never` when neither applies.
type FieldValueUnion<FieldState> = [EnumValueUnion<FieldState>] extends [never]
  ? DescriptorValueSetUnion<FieldState>
  : EnumValueUnion<FieldState>;

// The type that replaces a field's codec type: on both sides, the members of the enum or value set it holds; on the output side, the type its column spec's codec reads.
type FieldTypeOverride<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends ModelFieldNames<Definition, ModelName>,
> =
  ModelFieldState<Definition, ModelName, FieldName> extends infer FieldState
    ? [FieldValueUnion<FieldState>] extends [never]
      ? [ColumnSpecCodecOutput<FieldDescriptorOf<FieldState>>] extends [never]
        ? never
        : { readonly output: ColumnSpecCodecOutput<FieldDescriptorOf<FieldState>> }
      : {
          readonly output: FieldValueUnion<FieldState>;
          readonly input: FieldValueUnion<FieldState>;
        }
    : never;

type FieldTypeOverrides<Definition> = {
  readonly [Ns in DomainNamespaceIds<Definition>]: {
    readonly models: {
      readonly [ModelName in ModelsInNamespace<Definition, Ns>]: {
        readonly [FieldName in ModelFieldNames<Definition, ModelName>]: FieldTypeOverride<
          Definition,
          ModelName,
          FieldName
        >;
      };
    };
  };
};

type ColumnTypeOverrides<Definition> = {
  readonly [Ns in StorageNamespaceIds<Definition>]: {
    readonly [ModelName in ModelsInNamespace<Definition, Ns> as BuiltModelTableName<
      Definition,
      ModelName
    >]: {
      readonly [FieldName in ModelFieldNames<Definition, ModelName> as BuiltModelColumnMappings<
        Definition,
        ModelName
      >[FieldName]['column']]: FieldTypeOverride<Definition, ModelName, FieldName>;
    };
  };
};

// Resolves a field or column type map, so declaration output writes the map itself rather than the generic and the whole contract shape it reads.
type ResolvedTypeMap<Map> = {
  readonly [Ns in keyof Map]: {
    readonly [Entity in keyof Map[Ns]]: string extends keyof Map[Ns][Entity]
      ? Map[Ns][Entity]
      : { readonly [Name in keyof Map[Ns][Entity]]: Map[Ns][Entity][Name] };
  };
};

type BuiltDomainNamespaces<Definition> = {
  readonly [Ns in DomainNamespaceIds<Definition>]: BuiltDomainNamespace<Definition, Ns>;
};

export type SqlContractResult<Definition> = ContractWithTypeMaps<
  Omit<Contract<BuiltStorage<Definition>>, 'domain' | 'execution'> &
    BuiltExecution<Definition> & {
      readonly target: DefinitionTargetId<Definition>;
      readonly targetFamily: 'sql';
    } & {
      readonly domain: {
        readonly namespaces: BuiltDomainNamespaces<Definition>;
      } & BuiltDomain<Definition>;
    } & {
      readonly extensions: DefinitionExtensions<Definition>;
      readonly capabilities: DerivedCapabilities<Definition>;
    },
  // The shape of `TypeMaps`, written out so the aggregate types are not checked against `AggregateTypesBase` for every contract: their settled shape satisfies it, and the parity test compares them with the emitted ones.
  {
    readonly codecTypes: CodecTypesFromDefinition<Definition>;
    readonly queryOperationTypes: QueryOperationTypesFromDefinition<Definition>;
    readonly fieldOutputTypes: ResolvedTypeMap<
      FieldTypesFromDomain<
        BuiltDomainNamespaces<Definition>,
        CodecTypesFromDefinition<Definition>,
        ParameterizedOutputTypesFromDefinition<Definition>,
        FieldTypeOverrides<Definition>,
        'output',
        BuiltStorage<Definition>['namespaces']
      >
    >;
    readonly fieldInputTypes: ResolvedTypeMap<
      FieldTypesFromDomain<
        BuiltDomainNamespaces<Definition>,
        CodecTypesFromDefinition<Definition>,
        ParameterizedOutputTypesFromDefinition<Definition>,
        FieldTypeOverrides<Definition>,
        'input',
        BuiltStorage<Definition>['namespaces']
      >
    >;
    readonly storageColumnTypes: ResolvedTypeMap<
      ColumnTypesFromStorage<
        BuiltStorage<Definition>,
        CodecTypesFromDefinition<Definition>,
        ParameterizedOutputTypesFromDefinition<Definition>,
        ColumnTypeOverrides<Definition>,
        'output'
      >
    >;
    readonly storageColumnInputTypes: ResolvedTypeMap<
      ColumnTypesFromStorage<
        BuiltStorage<Definition>,
        CodecTypesFromDefinition<Definition>,
        ParameterizedOutputTypesFromDefinition<Definition>,
        ColumnTypeOverrides<Definition>,
        'input'
      >
    >;
    readonly aggregateTypes: AggregateTypesFromDefinition<Definition>;
  }
>;
