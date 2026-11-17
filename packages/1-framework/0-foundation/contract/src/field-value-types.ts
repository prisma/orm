import type {
  ParameterizedOutputType,
  ParameterizedOutputTypesFunction,
} from './parameterized-output-types';

export type ValueTypeSide = 'output' | 'input';

type Lookup<T, Key> = Key extends keyof T ? T[Key] : never;

type NonEmptyTypeParams<TypeParams> =
  TypeParams extends Record<string, unknown>
    ? keyof TypeParams extends never
      ? undefined
      : TypeParams
    : undefined;

type PlainCodecType<
  CodecTypes,
  CodecId,
  Side extends ValueTypeSide,
> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId] extends { readonly [S in Side]: infer Plain }
    ? Plain
    : unknown
  : unknown;

type CodecType<
  CodecTypes,
  CodecId,
  TypeParams,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Side extends ValueTypeSide,
> = Side extends 'output'
  ? NonEmptyTypeParams<TypeParams> extends infer Params extends Record<string, unknown>
    ? ParameterizedOutputType<
        ParameterizedOutputs,
        CodecId,
        Params,
        PlainCodecType<CodecTypes, CodecId, Side>
      >
    : PlainCodecType<CodecTypes, CodecId, Side>
  : PlainCodecType<CodecTypes, CodecId, Side>;

/**
 * `Override`, unless the codec's type map entry carries `keepsWrittenForm`: its data type holds values equal that have more than one stored form, so a read can return a value the override's member literals do not name, and the value keeps the codec's type.
 */
type MemberOverride<Override, CodecTypes, CodecId> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId] extends { readonly keepsWrittenForm: true }
    ? never
    : Override
  : Override;

/**
 * The type of an enum member's value as a query reads it: `Value`, the member's literal, unless the codec's type map entry carries `keepsWrittenForm`, when a read can return the member in another form and the member has the codec's output type. The emitted `contract.d.ts` and every `defineContract` builder type members by this rule.
 */
export type EnumMemberValueType<CodecTypes, CodecId, Value> = CodecId extends keyof CodecTypes
  ? CodecTypes[CodecId] extends { readonly keepsWrittenForm: true; readonly output: infer Output }
    ? Output
    : Value
  : Value;

type BaseType<Override, Base, Side extends ValueTypeSide> = [Override] extends [never]
  ? Base
  : Override extends { readonly [S in Side]: infer T }
    ? T
    : Base;

/**
 * The type of the value one storage entry holds, after its override, its list or dictionary wrapping and its nullability. `Item` is the entry, with optional `nullable`, `many` and `dict`, holding values of codec `CodecId`. On each side the value is typed by `Override` for that side when it gives one, else, on the output side, by the type a type function in `ParameterizedOutputs` gives a value with these type parameters, else by the codec's type in `CodecTypes`, or `unknown` for a codec it lacks. A family's storage type maps apply it to each storage entry.
 */
export type StoredValueType<
  Item,
  CodecId,
  TypeParams,
  Override,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Side extends ValueTypeSide,
> = Item extends {
  readonly many?: infer Many;
  readonly dict?: infer Dictionary;
}
  ? ScalarValueType<
      CodecId,
      TypeParams,
      Override,
      NullableFlag<Item>,
      Many,
      Dictionary,
      CodecTypes,
      ParameterizedOutputs,
      Side
    >
  : never;

type NullableFlag<Entry> = Entry extends { readonly nullable: true } ? true : false;

type ClosedWhenEmpty<T> = [keyof T] extends [never] ? Record<string, never> : T;

// A model without fields has `{}` output types, and `Record<string, never>` input types, since TypeScript accepts any object where `{}` is expected.
type InputClosedWhenEmpty<Side extends ValueTypeSide, T> = Side extends 'input'
  ? ClosedWhenEmpty<T>
  : T;

type ContractParts<StorageNamespaces, Overrides> = {
  readonly storage: StorageNamespaces;
  readonly overrides: Overrides;
};

type ValueObjectFields<Ns, Name, Parts> = Lookup<
  Lookup<Lookup<Lookup<Lookup<Lookup<Parts, 'storage'>, Ns>, 'entries'>, 'valueObject'>, Name>,
  'fields'
>;

type ValueObjectType<
  Ns,
  Name,
  Parts,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Side extends ValueTypeSide,
> = ClosedWhenEmpty<{
  readonly [F in keyof ValueObjectFields<Ns, Name, Parts>]: FieldValueType<
    ValueObjectFields<Ns, Name, Parts>[F],
    Lookup<Lookup<Lookup<Lookup<Lookup<Parts, 'overrides'>, Ns>, 'valueObjects'>, Name>, F>,
    Parts,
    CodecTypes,
    ParameterizedOutputs,
    Side
  >;
}>;

// The type of a value object, a union, or a field of a kind this file does not know, before modifiers. Scalar fields are typed by `ScalarValueType`.
type ElementType<
  FieldType,
  Parts,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Side extends ValueTypeSide,
> = FieldType extends {
  readonly kind: 'valueObject';
  readonly namespaceId: infer Ns;
  readonly entityName: infer Name;
}
  ? ValueObjectType<Ns, Name, Parts, CodecTypes, ParameterizedOutputs, Side>
  : FieldType extends {
        readonly kind: 'union';
        readonly members: infer Members extends readonly unknown[];
      }
    ? UnionMemberType<Members[number], Parts, CodecTypes, ParameterizedOutputs, Side>
    : unknown;

type UnionMemberType<
  Member,
  Parts,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Side extends ValueTypeSide,
> = Member extends { readonly kind: 'scalar'; readonly codecId: infer CodecId }
  ? PlainCodecType<CodecTypes, CodecId, Side>
  : ElementType<Member, Parts, CodecTypes, ParameterizedOutputs, Side>;

type Listed<Base, Many> = [Many] extends [{ readonly elementNullable: infer ElementNullable }]
  ? ReadonlyArray<Base | (ElementNullable extends true ? null : never)>
  : Base;

// The union is written here, and read through an indexed access, so TypeScript prints the resolved type, such as `bigint | null`, in hovers and errors instead of this file's generics.
type WithModifiers<Base, Nullable, Many, Dictionary> =
  | ([Dictionary] extends [true]
      ? Readonly<Record<string, Listed<Base, Many>>>
      : Listed<Base, Many>)
  | ([Nullable] extends [true] ? null : never) extends infer Value
  ? { readonly [K in 'value']: Value }['value']
  : never;

// A scalar field's value from its parts, which are literals, so fields with the same codec and modifiers share one instantiation.
type ScalarValueType<
  CodecId,
  TypeParams,
  Override,
  Nullable,
  Many,
  Dictionary,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Side extends ValueTypeSide,
> = WithModifiers<
  BaseType<
    MemberOverride<Override, CodecTypes, CodecId>,
    CodecType<CodecTypes, CodecId, TypeParams, ParameterizedOutputs, Side>,
    Side
  >,
  Nullable,
  Many,
  Dictionary
>;

type FieldValueType<
  Field,
  Override,
  Parts,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Side extends ValueTypeSide,
> = Field extends {
  readonly type: {
    readonly kind: 'scalar';
    readonly codecId: infer CodecId;
    readonly typeParams?: infer TypeParams;
  };
  readonly many?: infer Many;
  readonly dict?: infer Dictionary;
}
  ? ScalarValueType<
      CodecId,
      TypeParams,
      Override,
      NullableFlag<Field>,
      Many,
      Dictionary,
      CodecTypes,
      ParameterizedOutputs,
      Side
    >
  : // `ElementType` types value objects too; this branch keys their instantiations by namespace and name alone, which costs less.
    Field extends {
        readonly type: {
          readonly kind: 'valueObject';
          readonly namespaceId: infer Ns;
          readonly entityName: infer Name;
        };
        readonly many?: infer Many;
        readonly dict?: infer Dictionary;
      }
    ? WithModifiers<
        BaseType<
          Override,
          ValueObjectType<Ns, Name, Parts, CodecTypes, ParameterizedOutputs, Side>,
          Side
        >,
        NullableFlag<Field>,
        Many,
        Dictionary
      >
    : Field extends {
          readonly type: infer FieldType;
          readonly many?: infer Many;
          readonly dict?: infer Dictionary;
        }
      ? WithModifiers<
          BaseType<
            Override,
            ElementType<FieldType, Parts, CodecTypes, ParameterizedOutputs, Side>,
            Side
          >,
          NullableFlag<Field>,
          Many,
          Dictionary
        >
      : never;

/**
 * `FieldOutputTypes` (`Side` `'output'`) or `FieldInputTypes` (`'input'`) of a contract whose domain namespaces are `DomainNamespaces` and whose storage namespaces are `StorageNamespaces`, computed from the contract's literal shape. It reads both planes: the domain for the fields, and storage for the value objects the fields refer to, so it always takes both. Both an emitted `contract.d.ts` and a contract written with `defineContract` type their fields through it.
 *
 * Each value is typed by, in order:
 *
 * 1. its override for that side, `{ output?, input? }`, from `Overrides` at `[namespace]['models'][model][field]` for a model field, or at `[storage namespace]['valueObjects'][valueObject][field]` for a value object field. An override is the type of a field that the contract's shape and the codec types cannot give: the members of the value set it holds, the type its codec renders as text, or the type a family's storage entry gives it;
 * 2. for a scalar field, on the output side, the type a pack's type function in `ParameterizedOutputs` gives it for its type parameters (`ParameterizedOutputType`), else its codec's `output` or `input` type, or `unknown` for a codec `CodecTypes` lacks;
 * 3. for a value object field, an object of the field types of the value object its reference names in `StorageNamespaces`, at `[namespaceId]['entries']['valueObject'][entityName]`, computed by these rules;
 * 4. for a union field, the union of its members' types, each a codec's plain type or a value object's type;
 *
 * then wrapped in `ReadonlyArray` for a list and in `Readonly<Record<string, …>>` for a dictionary, with `null` for a nullable element or value. A model without fields has `{}` output types and `Record<string, never>` input types; a value object without fields has `Record<string, never>` on both sides.
 */
export type FieldTypesFromDomain<
  DomainNamespaces,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Overrides,
  Side extends ValueTypeSide,
  StorageNamespaces,
> = {
  readonly [Ns in keyof DomainNamespaces]: NamespaceFieldTypes<
    Lookup<DomainNamespaces[Ns], 'models'>,
    Lookup<Overrides, Ns>,
    ContractParts<StorageNamespaces, Overrides>,
    CodecTypes,
    ParameterizedOutputs,
    Side
  >;
};

type NamespaceFieldTypes<
  Models,
  NamespaceOverrides,
  Parts,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Side extends ValueTypeSide,
> = {
  readonly [M in keyof Models]: Lookup<Models[M], 'fields'> extends infer Fields
    ? [Fields] extends [never]
      ? never
      : // The fields are a mapped type written here, not an alias, so hovers and errors show the field types.
        InputClosedWhenEmpty<
          Side,
          {
            readonly [F in keyof Fields]: FieldValueType<
              Fields[F],
              Lookup<Lookup<Lookup<NamespaceOverrides, 'models'>, M>, F>,
              Parts,
              CodecTypes,
              ParameterizedOutputs,
              Side
            >;
          }
        >
    : never;
};

/**
 * The output (`Side` `'output'`) or input (`'input'`) type of each value object of a contract whose storage namespaces are `StorageNamespaces`, keyed by storage namespace and value object name, by the rules of {@link FieldTypesFromDomain}.
 */
export type ValueObjectTypesFromStorage<
  StorageNamespaces,
  CodecTypes,
  ParameterizedOutputs extends ParameterizedOutputTypesFunction,
  Overrides,
  Side extends ValueTypeSide,
> = {
  readonly [Ns in keyof StorageNamespaces]: {
    readonly [V in keyof Lookup<
      Lookup<StorageNamespaces[Ns], 'entries'>,
      'valueObject'
    >]: ValueObjectType<
      Ns,
      V,
      ContractParts<StorageNamespaces, Overrides>,
      CodecTypes,
      ParameterizedOutputs,
      Side
    >;
  };
};
