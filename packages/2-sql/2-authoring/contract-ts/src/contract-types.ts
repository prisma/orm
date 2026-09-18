import type {
  ColumnDefault,
  Contract,
  ContractEnum,
  ContractRelation,
  ContractValueObject,
  NamespaceId,
  StorageHashBase,
} from '@internal/contract/types';
import type { ExtensionPackRef, TargetPackRef } from '@internal/framework-components/components';
import type { StorageType } from '@internal/framework-components/ir';
import type { IndexTypeRegistration } from '@internal/sql-contract/index-types';
import type {
  ContractWithTypeMaps,
  Index,
  ReferentialAction,
  StorageTypeInstance,
  TypeMaps,
} from '@internal/sql-contract/types';
import type { AggregateTypesFromPacks } from './aggregate-types';
import type { UnionToIntersection } from './authoring-type-utils';
import type { AttributeStageIdFieldNames, FieldStateOf, ScalarFieldBuilder } from './contract-dsl';
import type { EnumTypeHandle } from './enum-type';

export type PublicCodecTypes<CodecTypes extends Record<string, { readonly output: unknown }>> = {
  readonly [CodecId in keyof CodecTypes]: Pick<
    CodecTypes[CodecId],
    Extract<keyof CodecTypes[CodecId], 'input' | 'output' | 'traits'>
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

type MergeExtensionCodecTypesSafe<Packs> =
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
  readonly extensions?: infer Packs;
}
  ? [Exclude<Packs, undefined>] extends [never]
    ? Record<never, never>
    : Exclude<Packs, undefined>
  : Record<never, never>;

type ExtractPackCapabilities<P> = P extends {
  readonly capabilities?: infer Caps extends Record<string, Record<string, boolean>>;
}
  ? Caps
  : never;

type MergeExtensionPackCapabilities<Packs> =
  Packs extends Record<string, unknown>
    ? keyof Packs extends never
      ? Record<string, never>
      : UnionToIntersection<
          {
            [K in keyof Packs]: ExtractPackCapabilities<Packs[K]>;
          }[keyof Packs]
        >
    : Record<string, never>;

type Defaulted<T, Fallback> = [T] extends [never] ? Fallback : T;

// Build-time capability derivation no longer reads an author-declared
// `capabilities` block — that field was removed from the `defineContract`
// input. The build-time matrix is the merge of the target pack's caps and
// every extension pack's caps; adapter and driver caps are layered in by
// `enrichContract` at CLI emit time.
type DerivedCapabilities<Definition> = Defaulted<
  ExtractPackCapabilities<DefinitionTarget<Definition>>,
  Record<string, never>
> &
  MergeExtensionPackCapabilities<DefinitionExtensions<Definition>>;

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
  readonly types?: unknown;
}
  ? Present<Definition['types']> extends Record<string, StorageType>
    ? Present<Definition['types']>
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

type FieldTypeRefOf<FieldState> = Present<
  FieldState extends { readonly typeRef?: infer TypeRef } ? TypeRef : never
>;

type FieldNullableOf<FieldState> = FieldState extends {
  readonly nullable: infer Nullable extends boolean;
}
  ? Nullable
  : boolean;

type FieldManyOf<FieldState> = FieldState extends { readonly many?: infer Many }
  ? true extends Many
    ? true
    : false
  : false;

type FieldColumnOverrideOf<FieldState> = Present<
  FieldState extends { readonly columnName?: infer ColumnName } ? ColumnName : never
>;

type FieldInlineIdSpecOf<FieldState> = Present<
  FieldState extends { readonly id?: infer IdSpec } ? IdSpec : never
>;

type DescriptorCodecId<Descriptor> = Descriptor extends {
  readonly codecId: infer CodecId extends string;
}
  ? CodecId
  : string;

type DescriptorNativeType<Descriptor> = Descriptor extends {
  readonly nativeType: infer NativeType extends string;
}
  ? NativeType
  : string;

type DescriptorTypeParams<Descriptor> = Descriptor extends {
  readonly typeParams: infer TypeParams extends Record<string, unknown>;
}
  ? TypeParams
  : undefined;

type DescriptorTypeRef<Descriptor> = Descriptor extends {
  readonly typeRef: infer TypeRef extends string;
}
  ? TypeRef
  : undefined;

type LookupNamedStorageTypeKeyByValue<Definition, TypeRef extends StorageType> = {
  [TypeName in keyof DefinitionTypes<Definition> & string]: [TypeRef] extends [
    DefinitionTypes<Definition>[TypeName],
  ]
    ? [DefinitionTypes<Definition>[TypeName]] extends [TypeRef]
      ? TypeName
      : never
    : never;
}[keyof DefinitionTypes<Definition> & string];

type ResolveNamedStorageTypeKey<Definition, TypeRef> = TypeRef extends string
  ? TypeRef
  : TypeRef extends StorageType
    ? [LookupNamedStorageTypeKeyByValue<Definition, TypeRef>] extends [never]
      ? string
      : LookupNamedStorageTypeKeyByValue<Definition, TypeRef>
    : never;

type ResolveNamedStorageType<Definition, TypeRef> =
  ResolveNamedStorageTypeKey<Definition, TypeRef> extends infer TypeName extends string
    ? TypeName extends keyof DefinitionTypes<Definition>
      ? DefinitionTypes<Definition>[TypeName]
      : StorageTypeInstance
    : StorageTypeInstance;

// An enum-typed field carries its `EnumTypeHandle` (an object with a `codecId`
// and `nativeType`, but no `kind`) as the field's `typeRef`. It is neither a
// string nor a registered `StorageType`, so the named-type lookup cannot reach
// it; `EnumFieldHandle` short-circuits the resolvers to read codec + native type
// straight off the handle, with no column type-ref (the enum name is carried
// elsewhere). The `[...] extends [never]` guard excludes plain column fields,
// whose `typeRef` is `never`.
type EnumFieldHandle<FieldState> = [FieldTypeRefOf<FieldState>] extends [never]
  ? never
  : FieldTypeRefOf<FieldState> extends EnumTypeHandle
    ? FieldTypeRefOf<FieldState>
    : never;

type EnumHandleDescriptor<Handle> = Handle extends {
  readonly codecId: infer CodecId extends string;
  readonly nativeType: infer NativeType extends string;
}
  ? { readonly codecId: CodecId; readonly nativeType: NativeType }
  : never;

type ResolveFieldDescriptor<Definition, FieldState> = [EnumFieldHandle<FieldState>] extends [never]
  ? [FieldDescriptorOf<FieldState>] extends [never]
    ? ResolveNamedStorageType<Definition, FieldTypeRefOf<FieldState>>
    : FieldDescriptorOf<FieldState>
  : EnumHandleDescriptor<EnumFieldHandle<FieldState>>;

type ResolveFieldColumnTypeRef<Definition, FieldState> = [EnumFieldHandle<FieldState>] extends [
  never,
]
  ? [FieldTypeRefOf<FieldState>] extends [never]
    ? DescriptorTypeRef<FieldDescriptorOf<FieldState>>
    : ResolveNamedStorageTypeKey<Definition, FieldTypeRefOf<FieldState>>
  : undefined;

type ResolveFieldColumnTypeParams<Definition, FieldState> = [
  ResolveFieldColumnTypeRef<Definition, FieldState>,
] extends [string]
  ? undefined
  : DescriptorTypeParams<FieldDescriptorOf<FieldState>>;

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
  NativeType extends string,
  TypeRef extends string | undefined = undefined,
  TypeParams extends Record<string, unknown> | undefined = undefined,
  Many extends boolean = false,
> = {
  readonly nativeType: NativeType;
  readonly codecId: CodecId;
  readonly nullable: Nullable;
  readonly default?: ColumnDefault;
} & (TypeRef extends string ? { readonly typeRef: TypeRef } : Record<never, never>) &
  (TypeParams extends Record<string, unknown>
    ? { readonly typeParams: TypeParams }
    : Record<never, never>) &
  (Many extends true ? { readonly many: true } : Record<never, never>);

type ModelStorageColumn<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends string,
> =
  FieldName extends ModelFieldNames<Definition, ModelName>
    ? StorageColumn<
        DescriptorCodecId<
          ResolveFieldDescriptor<Definition, ModelFieldState<Definition, ModelName, FieldName>>
        >,
        FieldNullableOf<ModelFieldState<Definition, ModelName, FieldName>>,
        DescriptorNativeType<
          ResolveFieldDescriptor<Definition, ModelFieldState<Definition, ModelName, FieldName>>
        >,
        ResolveFieldColumnTypeRef<Definition, ModelFieldState<Definition, ModelName, FieldName>>,
        ResolveFieldColumnTypeParams<Definition, ModelFieldState<Definition, ModelName, FieldName>>,
        FieldManyOf<ModelFieldState<Definition, ModelName, FieldName>>
      >
    : never;

type RelationModelName<Source> = Source extends { readonly modelName: infer Name extends string }
  ? Name
  : Source extends { readonly resolve: () => infer Name extends string }
    ? Name
    : never;

type FieldTuple<Fields> = Fields extends readonly string[]
  ? Fields
  : Fields extends string
    ? readonly [Fields]
    : readonly [];

type RelationNullable<Definition, ModelName extends ModelNames<Definition>, Fields> = true extends {
  [Field in Extract<
    FieldTuple<Fields>[number],
    ModelFieldNames<Definition, ModelName>
  >]: FieldNullableOf<ModelFieldState<Definition, ModelName, Field>>;
}[Extract<FieldTuple<Fields>[number], ModelFieldNames<Definition, ModelName>>]
  ? true
  : false;

type BuiltRelation<
  Definition,
  ModelName extends ModelNames<Definition>,
  Builder,
> = Builder extends { readonly __state: infer State }
  ? State extends { readonly kind: infer Kind; readonly toModel: infer Target }
    ? {
        readonly to: {
          readonly namespace: RelationModelName<Target> extends ModelNames<Definition>
            ? ModelNamespaceId<Definition, RelationModelName<Target>> & NamespaceId
            : NamespaceId;
          readonly model: RelationModelName<Target>;
        };
      } & (State extends {
        readonly kind: 'belongsTo';
        readonly from: infer From;
        readonly to: infer To;
      }
        ? {
            readonly cardinality: 'N:1';
            readonly nullable: RelationNullable<Definition, ModelName, From>;
            readonly on: {
              readonly localFields: FieldTuple<From>;
              readonly targetFields: FieldTuple<To>;
            };
          }
        : State extends { readonly kind: 'hasOne' | 'hasMany'; readonly by: infer By }
          ? {
              readonly cardinality: Kind extends 'hasOne' ? '1:1' : '1:N';
              readonly nullable: true;
              readonly on: {
                readonly localFields: FieldTuple<ModelIdFieldNames<Definition, ModelName>>;
                readonly targetFields: FieldTuple<By>;
              };
            }
          : Omit<Extract<ContractRelation, { readonly cardinality: 'N:M' }>, 'to'>)
    : never
  : never;

type BuiltModels<Definition> = {
  readonly [ModelName in ModelNames<Definition>]: {
    readonly storage: {
      readonly namespaceId: ModelNamespaceId<Definition, ModelName>;
      readonly table: ModelTableName<Definition, ModelName>;
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
        };
      };
    };
    readonly relations: {
      readonly [RelName in StagedModelRelationNames<Definition, ModelName>]: BuiltRelation<
        Definition,
        ModelName,
        StagedModelRelations<Definition, ModelName>[RelName]
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

type BuiltStorageTables<Definition, Ns extends string> = {
  readonly [ModelName in ModelsInNamespace<Definition, Ns> as BuiltModelTableName<
    Definition,
    ModelName
  >]: {
    readonly columns: BuiltStorageTableColumns<Definition, ModelName>;
    readonly uniques: ReadonlyArray<{
      readonly columns: readonly string[];
      readonly name?: string;
    }>;
    readonly indexes: ReadonlyArray<Index>;
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
      readonly constraint: boolean;
      readonly index: boolean;
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
    : Record<string, never>);
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

type BuiltDocumentScopedTypes<Definition> = {
  readonly [K in keyof DefinitionTypes<Definition> as DefinitionTypes<Definition>[K] extends StorageTypeInstance
    ? K
    : never]: DefinitionTypes<Definition>[K];
};

type BuiltDomainNamespace<Definition, Ns extends string> = {
  readonly models: Pick<BuiltModels<Definition>, ModelsInNamespace<Definition, Ns>>;
  readonly valueObjects?: Record<string, ContractValueObject>;
  readonly enum?: Record<string, ContractEnum>;
};

type DefaultStorageNamespaceId<Definition> =
  DefinitionTarget<Definition> extends {
    readonly defaultNamespaceId: infer Ns extends string;
  }
    ? Ns
    : '__unbound__';

type ModelNamespaceId<
  Definition,
  ModelName extends ModelNames<Definition>,
> = DefinitionModels<Definition>[ModelName] extends {
  readonly stageOne: { readonly namespace?: infer Ns };
}
  ? [Exclude<Ns, undefined>] extends [never]
    ? DefaultStorageNamespaceId<Definition>
    : Exclude<Ns, undefined> extends infer Name extends string
      ? Name extends 'unbound'
        ? '__unbound__'
        : Name
      : DefaultStorageNamespaceId<Definition>
  : DefaultStorageNamespaceId<Definition>;

type ModelsInNamespace<Definition, Ns extends string> = {
  [Name in ModelNames<Definition>]: ModelNamespaceId<Definition, Name> extends Ns ? Name : never;
}[ModelNames<Definition>];

type ModelNamespaceIds<Definition> = {
  [Name in ModelNames<Definition>]: ModelNamespaceId<Definition, Name>;
}[ModelNames<Definition>];

type StorageNamespaceIds<Definition> =
  | DefaultStorageNamespaceId<Definition>
  | DefinitionNamespaces<Definition>
  | ModelNamespaceIds<Definition>;

type BuiltStorage<Definition> = {
  readonly storageHash: StorageHashBase<string>;
  readonly types?: BuiltDocumentScopedTypes<Definition>;
  readonly namespaces: {
    readonly [Ns in StorageNamespaceIds<Definition>]: {
      readonly id: Ns;
      readonly kind: string;
      readonly entries: {
        readonly table: BuiltStorageTables<Definition, Ns>;
      };
    };
  };
};

type StorageColumnManyOf<Col> = Col extends { readonly many: true } ? true : false;

// The enum value union for an enum-typed field, or `never` for a non-enum
// field. The field's `typeRef` carries the authored `EnumTypeHandle`, whose
// `Values` tuple preserves the literal member values (text or numeric).
type EnumValueUnion<FieldState> = [FieldTypeRefOf<FieldState>] extends [
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

// The codec's `output` / `input` JS type for a field's column, before
// nullability. `unknown` when the codec is not in the definition's codec map.
type CodecChannelType<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends ModelFieldNames<Definition, ModelName>,
  Channel extends 'output' | 'input',
> = ModelStorageColumn<Definition, ModelName, FieldName>['codecId'] extends infer Id extends
  keyof CodecTypesFromDefinition<Definition>
  ? CodecTypesFromDefinition<Definition>[Id] extends { readonly [K in Channel]: infer T }
    ? StorageColumnManyOf<ModelStorageColumn<Definition, ModelName, FieldName>> extends true
      ? ReadonlyArray<T>
      : T
    : unknown
  : unknown;

// The literal value union for a field: the enum-typed union takes precedence
// (matching today's behavior), falling back to the descriptor-carried
// value-set union; `never` when neither applies.
type FieldValueUnion<FieldState> = [EnumValueUnion<FieldState>] extends [never]
  ? DescriptorValueSetUnion<FieldState>
  : EnumValueUnion<FieldState>;

// A field's read/write JS type: the value union (enum or descriptor value-set)
// when the field carries one, otherwise the codec channel type, with column
// nullability applied.
type FieldChannelType<
  Definition,
  ModelName extends ModelNames<Definition>,
  FieldName extends ModelFieldNames<Definition, ModelName>,
  Channel extends 'output' | 'input',
> =
  | ([FieldValueUnion<ModelFieldState<Definition, ModelName, FieldName>>] extends [never]
      ? CodecChannelType<Definition, ModelName, FieldName, Channel>
      : StorageColumnManyOf<ModelStorageColumn<Definition, ModelName, FieldName>> extends true
        ? ReadonlyArray<FieldValueUnion<ModelFieldState<Definition, ModelName, FieldName>>>
        : FieldValueUnion<ModelFieldState<Definition, ModelName, FieldName>>)
  | (FieldNullableOf<ModelFieldState<Definition, ModelName, FieldName>> extends true
      ? null
      : never);

type FieldChannelTypes<Definition, Channel extends 'output' | 'input'> = {
  readonly [Ns in StorageNamespaceIds<Definition>]: {
    readonly [ModelName in ModelsInNamespace<Definition, Ns>]: {
      readonly [FieldName in ModelFieldNames<Definition, ModelName>]: FieldChannelType<
        Definition,
        ModelName,
        FieldName,
        Channel
      >;
    };
  };
};

type StorageColumnChannelTypes<Definition, Channel extends 'output' | 'input'> = {
  readonly [Ns in StorageNamespaceIds<Definition>]: {
    readonly [ModelName in ModelsInNamespace<Definition, Ns> as BuiltModelTableName<
      Definition,
      ModelName
    >]: {
      readonly [FieldName in ModelFieldNames<Definition, ModelName> as BuiltModelColumnMappings<
        Definition,
        ModelName
      >[FieldName]['column']]: FieldChannelType<Definition, ModelName, FieldName, Channel>;
    };
  };
};

export type SqlContractResult<Definition> = ContractWithTypeMaps<
  Omit<Contract<BuiltStorage<Definition>>, 'domain'> & {
    readonly target: DefinitionTargetId<Definition>;
    readonly targetFamily: 'sql';
  } & {
    readonly domain: {
      readonly namespaces: {
        readonly [Ns in ModelNamespaceIds<Definition>]: BuiltDomainNamespace<Definition, Ns>;
      };
    };
  } & {
    readonly extensions: keyof DefinitionExtensions<Definition> extends never
      ? Record<string, never>
      : DefinitionExtensions<Definition>;
    readonly capabilities: DerivedCapabilities<Definition>;
    readonly enumAccessors: BuiltEnumAccessors<Definition>;
  },
  TypeMaps<
    CodecTypesFromDefinition<Definition>,
    Record<string, never>,
    FieldChannelTypes<Definition, 'output'>,
    FieldChannelTypes<Definition, 'input'>,
    StorageColumnChannelTypes<Definition, 'output'>,
    StorageColumnChannelTypes<Definition, 'input'>,
    AggregateTypesFromPacks<AllPacks<Definition>, CodecTypesFromDefinition<Definition>>
  >
>;
