import type {
  ContractFieldType,
  ControlPolicy,
  ExecutionMutationDefaultPhases,
  ExecutionMutationDefaultValue,
} from '@internal/contract/types';
import type {
  GeneratorFunctionCall,
  GeneratorPhase,
} from '@internal/framework-components/components';
import type {
  MongoCollectionOptionsAuthoringInput,
  MongoIndexAuthoringInput,
} from '@internal/mongo-contract';
import type { EnumTypeHandle } from './enum-type';

export type VariantSpec = {
  readonly value: string;
};

export type StorageRelationSpec = {
  readonly field: string;
};

export interface FieldBuilder<
  Type extends ContractFieldType = ContractFieldType,
  Nullable extends boolean = boolean,
  Many extends false | { readonly elementNullable: boolean } =
    | false
    | { readonly elementNullable: boolean },
  Handle extends EnumTypeHandle | undefined = EnumTypeHandle | undefined,
  ExecutionDefaults extends ExecutionMutationDefaultPhases | undefined = undefined,
  StoredName extends string | undefined = string | undefined,
> {
  readonly __kind: 'field';
  readonly __type: Type;
  readonly __nullable: Nullable;
  readonly __many: Many;
  readonly __enumHandle: Handle;
  readonly __executionDefaults?: ExecutionDefaults;
  readonly __storedName: StoredName;
  /** The generator function calls `.onCreate(...)` and `.onUpdate(...)` give, resolved by the field's codec when the contract is built. */
  readonly __generatorCalls?: FieldGeneratorCalls;
  /** Generates the field's value in the client when a document is created without one, with a call from `gen`, such as `gen.now()`. */
  onCreate(
    call: GeneratorFunctionCall,
  ): FieldBuilder<
    Type,
    Nullable,
    Many,
    Handle,
    WithGeneratedPhase<ExecutionDefaults, 'onCreate'>,
    StoredName
  >;
  /** Generates the field's value in the client every time a document is updated, with a call from `gen`, such as `gen.now()`. */
  onUpdate(
    call: GeneratorFunctionCall,
  ): FieldBuilder<
    Type,
    Nullable,
    Many,
    Handle,
    WithGeneratedPhase<ExecutionDefaults, 'onUpdate'>,
    StoredName
  >;
  readonly optional: () => FieldBuilder<Type, true, Many, Handle, ExecutionDefaults, StoredName>;
  readonly many: FilledOnWrite<ExecutionDefaults> extends true
    ? (this: 'This field generates a value on write, so it cannot be a list') => never
    : {
        (): FieldBuilder<
          Type,
          Nullable,
          { readonly elementNullable: false },
          Handle,
          ExecutionDefaults,
          StoredName
        >;
        (options: {
          readonly elementsNullable: false;
        }): FieldBuilder<
          Type,
          Nullable,
          { readonly elementNullable: false },
          Handle,
          ExecutionDefaults,
          StoredName
        >;
        (options: {
          readonly elementsNullable: true;
        }): FieldBuilder<
          Type,
          Nullable,
          { readonly elementNullable: true },
          Handle,
          ExecutionDefaults,
          StoredName
        >;
      };
  /** Store the field under `field` in its documents, as `.mongo({ field: '_id' })` stores the document id. */
  readonly mongo: <const Field extends string>(spec: {
    readonly field: Field;
  }) => FieldBuilder<Type, Nullable, Many, Handle, ExecutionDefaults, Field>;
}

export type FieldGeneratorCalls = {
  readonly onCreate?: GeneratorFunctionCall;
  readonly onUpdate?: GeneratorFunctionCall;
};

export type WithGeneratedPhase<
  ExecutionDefaults extends ExecutionMutationDefaultPhases | undefined,
  Phase extends GeneratorPhase,
> = (ExecutionDefaults extends undefined ? unknown : ExecutionDefaults) & {
  readonly [Key in Phase]: ExecutionMutationDefaultValue;
};

/**
 * Whether a generator call such as `.onCreate(gen.now())` fills the field on write. Distributes over a union, so the widest `FieldBuilder` constraint keeps both signatures and every field builder satisfies it.
 */
type FilledOnWrite<ExecutionDefaults> = ExecutionDefaults extends undefined
  ? false
  : [keyof ExecutionDefaults] extends [never]
    ? false
    : true;

export interface ValueObjectBuilder<
  Name extends string = string,
  Fields extends Record<string, AnyFieldBuilder> = Record<string, AnyFieldBuilder>,
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
  Fields extends Record<string, AnyFieldBuilder> = Record<string, AnyFieldBuilder>,
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

export type AnyFieldBuilder = FieldBuilder<
  ContractFieldType,
  boolean,
  false | { readonly elementNullable: boolean },
  EnumTypeHandle | undefined,
  ExecutionMutationDefaultPhases | undefined
>;
type AnyReferenceRelationBuilder = RelationBuilder<string, '1:1' | '1:N' | 'N:1', RelationOn>;
type AnyEmbedRelationBuilder = RelationBuilder<string, '1:1' | '1:N', undefined>;
export type AnyRelationBuilder = AnyReferenceRelationBuilder | AnyEmbedRelationBuilder;
export type AnyFieldReference = FieldReference<string, string>;
export type NamedValueObjectBuilder<
  Name extends string = string,
  Fields extends Record<string, AnyFieldBuilder> = Record<string, AnyFieldBuilder>,
> = ValueObjectBuilder<Name, Fields>;
export type AnyValueObjectBuilder = NamedValueObjectBuilder;
export type NamedModelBuilder<
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
export type AnyModelBuilder = NamedModelBuilder;

export type ModelNameInput = string | AnyModelBuilder;

export function resolveModelName(value: ModelNameInput): string {
  return typeof value === 'string' ? value : value.__name;
}
