import type {
  ArgTypeFromDescriptor,
  CanonicalArguments,
  DataTypeArgumentTypes,
  ExtractAuthoringNamespaceFromPack,
  ExtractDataTypeArgumentTypesFromPack,
  MergeExtensionAuthoringNamespaces,
  ResolveTemplateValue,
  TupleFromArgumentDescriptors,
  UnionToIntersection,
} from '@internal/contract-authoring';
import type {
  AuthoringArgumentDescriptor,
  AuthoringTypeAliasDescriptor,
  AuthoringTypeChoiceArgument,
  AuthoringTypeChoiceDescriptor,
  AuthoringTypeChoiceRow,
  AuthoringTypeConstructorDescriptor,
} from '@internal/framework-components/authoring';
import type { GeneratorFunctionCall } from '@internal/framework-components/components';
import type { FieldGeneratorCalls } from './contract-dsl';

/** The type of a MongoDB scalar field: its codec, and its type parameters when it has any. */
export type ScalarFieldType<
  CodecId extends string,
  TypeParams extends Record<string, unknown>,
> = keyof TypeParams extends never
  ? { readonly kind: 'scalar'; readonly codecId: CodecId }
  : { readonly kind: 'scalar'; readonly codecId: CodecId; readonly typeParams: TypeParams };

/** What a `type.*` helper returns: the field type, and for a type alias the generator calls every field typed by it takes. */
export type MongoTypeInstance = {
  readonly kind: 'scalar';
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown>;
  readonly generatorCalls?: FieldGeneratorCalls;
};

/** The type parameters a call gives, without those it leaves out, as the built field has them. */
type GivenTypeParams<TypeParams> = {
  readonly [Key in keyof TypeParams as TypeParams[Key] extends undefined ? never : Key]: Exclude<
    TypeParams[Key],
    undefined
  >;
};

type FieldTypeFromDescriptor<
  Descriptor extends AuthoringTypeConstructorDescriptor,
  Args extends readonly unknown[],
> = ScalarFieldType<
  Descriptor['output']['codecId'],
  Descriptor['output'] extends {
    readonly typeParams: infer TypeParams extends Record<string, unknown>;
  }
    ? GivenTypeParams<ResolveTemplateValue<TypeParams, Args>>
    : Record<never, never>
>;

type TypeHelperFunction<
  Descriptor extends AuthoringTypeConstructorDescriptor,
  ValueTypes extends DataTypeArgumentTypes,
> = Descriptor extends {
  readonly args: infer Args extends readonly AuthoringArgumentDescriptor[];
}
  ? <const Params extends TupleFromArgumentDescriptors<Args, ValueTypes>>(
      ...args: Params
    ) => FieldTypeFromDescriptor<Descriptor, CanonicalArguments<Args, Params, ValueTypes>>
  : () => FieldTypeFromDescriptor<Descriptor, readonly []>;

type RowDefault<Row extends AuthoringTypeChoiceRow, Name extends string> = Row extends {
  readonly defaults: infer Defaults;
}
  ? Name extends keyof Defaults
    ? Defaults[Name]
    : undefined
  : undefined;

/** The arguments a type choice passes on to the constructor its row chooses, by that constructor's argument positions: the written value, or the row's default. */
type PassedOnArguments<
  Parameters extends readonly AuthoringArgumentDescriptor[],
  Written extends object,
  Row extends AuthoringTypeChoiceRow,
> = {
  readonly [Index in keyof Parameters]: Parameters[Index] extends {
    readonly name: infer Name extends string;
  }
    ? Name extends keyof Written
      ? Written[Name] extends undefined
        ? RowDefault<Row, Name>
        : Written[Name]
      : RowDefault<Row, Name>
    : undefined;
};

type ChosenFieldType<
  Chosen,
  Written extends object,
  Row extends AuthoringTypeChoiceRow,
  ValueTypes extends DataTypeArgumentTypes,
> = Chosen extends AuthoringTypeConstructorDescriptor
  ? Chosen extends {
      readonly args: infer Parameters extends readonly AuthoringArgumentDescriptor[];
    }
    ? FieldTypeFromDescriptor<
        Chosen,
        CanonicalArguments<Parameters, PassedOnArguments<Parameters, Written, Row>, ValueTypes>
      >
    : FieldTypeFromDescriptor<Chosen, readonly []>
  : never;

type ParameterNames<Chosen> = Chosen extends {
  readonly args: readonly (infer Parameter)[];
}
  ? Parameter extends { readonly name: infer Name extends string }
    ? Name
    : never
  : never;

type RowValue<
  Row extends AuthoringTypeChoiceRow,
  Name extends string,
> = Name extends keyof Row['when'] ? Row['when'][Name] : never;

/** Whether `Row` gives the option `Argument` its default, so a call choosing the row may leave it out. */
type RowTakesDefault<
  Argument extends AuthoringTypeChoiceArgument,
  Row extends AuthoringTypeChoiceRow,
> = Argument extends { readonly default: infer Default }
  ? RowValue<Row, Argument['name']> extends Default
    ? true
    : false
  : true;

/** The options a call choosing `Row` must write: those whose value in the row is not their default. */
type RequiredRowOptions<
  Args extends readonly AuthoringTypeChoiceArgument[],
  Row extends AuthoringTypeChoiceRow,
> = {
  readonly [Argument in Args[number] as Argument extends { readonly kind: 'option' }
    ? RowTakesDefault<Argument, Row> extends true
      ? never
      : Argument['name']
    : never]: RowValue<Row, Argument['name']>;
};

/** What else a call choosing `Row` may write: an option the row gives its default, and an argument the chosen constructor takes. */
type OptionalRowArguments<
  Args extends readonly AuthoringTypeChoiceArgument[],
  Row extends AuthoringTypeChoiceRow,
  Chosen,
  ValueTypes extends DataTypeArgumentTypes,
> = {
  readonly [Argument in Args[number] as Argument extends { readonly kind: 'option' }
    ? RowTakesDefault<Argument, Row> extends true
      ? Argument['name']
      : never
    : Argument['name'] extends ParameterNames<Chosen>
      ? Argument['name']
      : never]?:
    | (Argument extends { readonly kind: 'option' }
        ? RowValue<Row, Argument['name']>
        : Argument extends AuthoringArgumentDescriptor
          ? ArgTypeFromDescriptor<Argument, ValueTypes>
          : never)
    | undefined;
};

/** `Params`, with every key `Allowed` does not name typed `never`, so a call writing such a key does not compile. */
type OnlyKeys<Params, Allowed extends PropertyKey> = Params & {
  readonly [Key in Exclude<keyof Params, Allowed>]: never;
};

type RowArguments<
  Args extends readonly AuthoringTypeChoiceArgument[],
  Row extends AuthoringTypeChoiceRow,
  Chosen,
  ValueTypes extends DataTypeArgumentTypes,
> = RequiredRowOptions<Args, Row> & OptionalRowArguments<Args, Row, Chosen, ValueTypes>;

type RowObjectHelperFunction<
  Args extends readonly AuthoringTypeChoiceArgument[],
  Row extends AuthoringTypeChoiceRow,
  Chosen,
  ValueTypes extends DataTypeArgumentTypes,
> = <const Params extends RowArguments<Args, Row, Chosen, ValueTypes>>(
  args: OnlyKeys<Params, keyof RowArguments<Args, Row, Chosen, ValueTypes>>,
) => ChosenFieldType<Chosen, Params, Row, ValueTypes>;

/** A call choosing `Row`: with no arguments too when the row gives every option its default. */
type RowHelperFunction<
  Args extends readonly AuthoringTypeChoiceArgument[],
  Row extends AuthoringTypeChoiceRow,
  Chosen,
  ValueTypes extends DataTypeArgumentTypes,
> = keyof RequiredRowOptions<Args, Row> extends never
  ? (() => ChosenFieldType<Chosen, Record<never, never>, Row, ValueTypes>) &
      RowObjectHelperFunction<Args, Row, Chosen, ValueTypes>
  : RowObjectHelperFunction<Args, Row, Chosen, ValueTypes>;

type RowOverloads<
  Args extends readonly AuthoringTypeChoiceArgument[],
  Rows extends readonly AuthoringTypeChoiceRow[],
  Namespace,
  ValueTypes extends DataTypeArgumentTypes,
> = Rows extends readonly [
  infer Row extends AuthoringTypeChoiceRow,
  ...infer Rest extends readonly AuthoringTypeChoiceRow[],
]
  ? RowHelperFunction<
      Args,
      Row,
      Row['type'] extends keyof Namespace ? Namespace[Row['type']] : never,
      ValueTypes
    > &
      RowOverloads<Args, Rest, Namespace, ValueTypes>
  : unknown;

/** A type choice's helper, which takes its arguments as one object keyed by name: one overload per row, so a call is typed by the row its option values choose, and a combination with no row, an unknown key, or an argument the chosen type does not take does not compile. */
type TypeChoiceHelperFunction<
  Descriptor extends AuthoringTypeChoiceDescriptor,
  Namespace,
  ValueTypes extends DataTypeArgumentTypes,
> = RowOverloads<Descriptor['args'], Descriptor['choices'], Namespace, ValueTypes>;

type AliasGeneratorCalls<Output> = (Output extends { readonly onCreate: GeneratorFunctionCall }
  ? { readonly onCreate: GeneratorFunctionCall }
  : unknown) &
  (Output extends { readonly onUpdate: GeneratorFunctionCall }
    ? { readonly onUpdate: GeneratorFunctionCall }
    : unknown);

type TypeAliasHelperFunction<Descriptor extends AuthoringTypeAliasDescriptor> =
  () => ScalarFieldType<
    Descriptor['output']['type']['codecId'],
    Descriptor['output']['type'] extends {
      readonly typeParams: infer TypeParams extends Record<string, unknown>;
    }
      ? TypeParams
      : Record<never, never>
  > &
    (Descriptor['output'] extends
      | { readonly onCreate: GeneratorFunctionCall }
      | { readonly onUpdate: GeneratorFunctionCall }
      ? { readonly generatorCalls: AliasGeneratorCalls<Descriptor['output']> }
      : unknown);

/** The `type` helpers of a type namespace: a call of a type constructor, type choice or type alias gives the field type it stands for. */
export type TypeHelpersFromNamespace<Namespace, ValueTypes extends DataTypeArgumentTypes> = {
  readonly [K in keyof Namespace]: Namespace[K] extends AuthoringTypeConstructorDescriptor
    ? TypeHelperFunction<Namespace[K], ValueTypes>
    : Namespace[K] extends AuthoringTypeAliasDescriptor
      ? TypeAliasHelperFunction<Namespace[K]>
      : Namespace[K] extends AuthoringTypeChoiceDescriptor
        ? TypeChoiceHelperFunction<Namespace[K], Namespace, ValueTypes>
        : Namespace[K] extends Record<string, unknown>
          ? TypeHelpersFromNamespace<Namespace[K], ValueTypes>
          : never;
};

type ExtractTypeNamespaceFromPack<Pack> = ExtractAuthoringNamespaceFromPack<
  Pack,
  'type',
  Record<never, never>
>;

type MergeExtensionDataTypeArgumentTypes<Extensions> =
  Extensions extends Record<string, unknown>
    ? keyof Extensions extends never
      ? Record<never, never>
      : UnionToIntersection<
          {
            [K in keyof Extensions]: ExtractDataTypeArgumentTypesFromPack<Extensions[K]>;
          }[keyof Extensions]
        >
    : Record<never, never>;

/** The `type` helpers of a stack: the type namespaces of its family, target and extension packs. */
export type TypeHelpersOfPacks<Family, Target, Extensions> = TypeHelpersFromNamespace<
  ExtractTypeNamespaceFromPack<Family> &
    ExtractTypeNamespaceFromPack<Target> &
    MergeExtensionAuthoringNamespaces<Extensions, 'type'>,
  ExtractDataTypeArgumentTypesFromPack<Family> &
    ExtractDataTypeArgumentTypesFromPack<Target> &
    MergeExtensionDataTypeArgumentTypes<Extensions>
>;
