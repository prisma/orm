import type {
  ContractField,
  ContractFieldType,
  ControlPolicy,
  ExecutionMutationDefaultPhases,
} from '@internal/contract/types';
import type { AuthoringWarning, WrittenValue } from '@internal/framework-components/authoring';
import type {
  ExtensionPackRef,
  GeneratorFunctionCall,
  TargetPackRef,
} from '@internal/framework-components/components';
import type {
  MongoCollectionOptionsAuthoringInput,
  MongoIndexFieldValue,
  MongoIndexOptionsInput,
} from '@internal/mongo-contract';
import type { EnumTypeHandle } from './enum-type';

/** The generator calls a source writes for a field, resolved for the field's codec when the contract is built. */
export interface GeneratorCallsNode {
  readonly onCreate?: GeneratorFunctionCall;
  readonly onUpdate?: GeneratorFunctionCall;
}

export interface FieldNode {
  readonly fieldName: string;
  /** The name documents store the field under, when the source gives one other than the field's own. */
  readonly storedName?: string;
  readonly type: ContractFieldType;
  readonly nullable: boolean;
  readonly many: NonNullable<ContractField['many']>;
  /** The name of the enum that types the field. */
  readonly enumName?: string;
  /** Defaults the field generates, already resolved from type aliases. */
  readonly executionDefaults?: ExecutionMutationDefaultPhases;
  readonly generatorCalls?: GeneratorCallsNode;
  /** Generators the field's own attributes set, which the source has already resolved for the field's codec. */
  readonly generatedValues?: ExecutionMutationDefaultPhases;
}

/** An index as the source wrote it. */
export interface IndexNode {
  /** Field name to its direction or index kind, in key order. */
  readonly fields: Readonly<Record<string, MongoIndexFieldValue>>;
  readonly options?: MongoIndexOptionsInput;
}

interface RelationNodeBase {
  readonly relationName: string;
  readonly toModel: string;
  /** Whether a to-one related document may be absent, as the source states it. */
  readonly nullable: boolean | undefined;
}

/** A relation to a model stored inside this model's documents. */
export interface EmbedRelationNode extends RelationNodeBase {
  readonly cardinality: '1:1' | '1:N';
  readonly on?: never;
}

/** A relation to documents joined on fields. */
export interface ReferenceRelationNode extends RelationNodeBase {
  readonly cardinality: '1:1' | '1:N' | 'N:1';
  readonly on: {
    readonly localFields: readonly string[];
    readonly targetFields: readonly string[];
  };
}

export type RelationNode = EmbedRelationNode | ReferenceRelationNode;

/** A variant's base model and the discriminator value that selects the variant, as the source wrote it. */
export interface VariantBaseNode {
  readonly model: string;
  /** Undefined when the base does not name a value for the variant. */
  readonly value: WrittenValue | undefined;
}

/** The field that tells the variants of a base apart. */
export interface DiscriminatorNode {
  readonly field: string;
  /** The variant models the source lists on the base, when it lists them there; each must name this model as its base. */
  readonly listedVariants?: readonly string[];
}

export interface ModelNode {
  readonly modelName: string;
  /** The collection the model is stored in; absent for a model stored only inside another. */
  readonly collection?: string;
  readonly owner?: string;
  readonly storageRelations?: Readonly<Record<string, { readonly field: string }>>;
  readonly controlPolicy?: ControlPolicy;
  readonly collectionOptions?: MongoCollectionOptionsAuthoringInput;
  /** In the order the source wrote them. */
  readonly indexes?: readonly IndexNode[];
  readonly fields: readonly FieldNode[];
  readonly relations?: readonly RelationNode[];
  readonly discriminator?: DiscriminatorNode;
  readonly base?: VariantBaseNode;
}

export interface ValueObjectNode {
  readonly name: string;
  readonly fields: readonly FieldNode[];
}

/** A MongoDB contract as plain data, with every name resolved, which `buildMongoContractFromDefinition` builds into a contract. */
export interface ContractDefinition {
  readonly target: TargetPackRef<'mongo', string>;
  readonly extensions?: Readonly<Record<string, ExtensionPackRef<string, string>>>;
  readonly defaultControlPolicy?: ControlPolicy;
  readonly models: readonly ModelNode[];
  readonly valueObjects?: readonly ValueObjectNode[];
  readonly enums?: Readonly<Record<string, EnumTypeHandle>>;
  /** Root name to model name. Derived from the models when absent. */
  readonly roots?: Readonly<Record<string, string>>;
  /** Whether each collection gets a validator derived from its models. Without validators, an enum a validator could not list is not refused. */
  readonly writesCollectionValidators: boolean;
  /** Warnings the source collected before the build, reported with the build's own. */
  readonly warnings: readonly AuthoringWarning[] | undefined;
}
