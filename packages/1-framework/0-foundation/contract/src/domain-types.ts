import type { CrossReference } from './cross-reference';
import type { JsonValue } from './types';
import type { ValueSetRef } from './value-set-ref';

export type ScalarFieldType = {
  readonly kind: 'scalar';
  readonly codecId: string;
  readonly typeParams?: Record<string, unknown>;
};

export type ValueObjectFieldType = {
  readonly kind: 'valueObject';
  readonly name: string;
};

export type UnionFieldType = {
  readonly kind: 'union';
  readonly members: ReadonlyArray<ScalarFieldType | ValueObjectFieldType>;
};

export type ContractFieldType = ScalarFieldType | ValueObjectFieldType | UnionFieldType;

export type ContractField = {
  readonly nullable: boolean;
  readonly type: ContractFieldType;
  readonly many?: true;
  readonly dict?: true;
  readonly valueSet?: ValueSetRef;
};

/**
 * A domain enum: an ordered set of named members, each with a codec-encoded
 * value. The `codecId` identifies the codec used to encode member values in
 * storage. The `members` array is ordered (declaration order is preserved).
 */
export type ContractEnum = {
  readonly codecId: string;
  readonly members: readonly { readonly name: string; readonly value: JsonValue }[];
};

export type ContractRelationOn = {
  readonly localFields: readonly string[];
  readonly targetFields: readonly string[];
};

export type ContractRelationThrough = {
  readonly table: string;
  readonly namespaceId: string;
  readonly parentColumns: readonly string[];
  readonly childColumns: readonly string[];
  readonly targetColumns: readonly string[];
};

export type ContractManyToManyRelation = {
  readonly to: CrossReference;
  readonly cardinality: 'N:M';
  readonly on: ContractRelationOn;
  readonly through: ContractRelationThrough;
};

/**
 * A to-one reference relation. `nullable` records whether the related row may be
 * absent, as stated by the schema (`author User?` versus `author User`).
 */
export type ContractToOneRelation = {
  readonly to: CrossReference;
  readonly cardinality: '1:1' | 'N:1';
  readonly nullable: boolean;
  readonly on: ContractRelationOn;
  readonly through?: never;
};

export type ContractToManyRelation = {
  readonly to: CrossReference;
  readonly cardinality: '1:N';
  readonly on: ContractRelationOn;
  readonly through?: never;
};

export type ContractNonJunctionRelation = ContractToOneRelation | ContractToManyRelation;

export type ContractReferenceRelation = ContractManyToManyRelation | ContractNonJunctionRelation;

export type ContractEmbedRelation = {
  readonly to: CrossReference;
  readonly cardinality: '1:1' | '1:N';
};

export type ContractRelation = ContractReferenceRelation | ContractEmbedRelation;

export type ContractDiscriminator = {
  readonly field: string;
};

export type ContractVariantEntry = {
  readonly value: string;
};

export type ContractValueObject = {
  readonly fields: Record<string, ContractField>;
};

export type ModelStorageBase = Readonly<Record<string, unknown>>;

export interface ContractModelBase<TModelStorage extends ModelStorageBase = ModelStorageBase> {
  readonly fields: Record<string, ContractField>;
  readonly relations: Record<string, ContractRelation>;
  readonly storage: TModelStorage;
  readonly discriminator?: ContractDiscriminator;
  readonly variants?: Record<string, ContractVariantEntry>;
  readonly base?: CrossReference;
  readonly owner?: string;
}

export interface ContractModel<TModelStorage extends ModelStorageBase = ModelStorageBase>
  extends ContractModelBase<TModelStorage> {
  readonly fields: Record<string, ContractField>;
}

// ── Relation key helpers ─────────────────────────────────────────────────────

export type ReferenceRelationKeys<
  TModels extends Record<string, { readonly relations: Record<string, ContractRelation> }>,
  ModelName extends string & keyof TModels,
> = {
  [K in keyof TModels[ModelName]['relations']]: TModels[ModelName]['relations'][K] extends ContractReferenceRelation
    ? K
    : never;
}[keyof TModels[ModelName]['relations']];

export type EmbedRelationKeys<
  TModels extends Record<string, { readonly relations: Record<string, ContractRelation> }>,
  ModelName extends string & keyof TModels,
> = {
  [K in keyof TModels[ModelName]['relations']]: TModels[ModelName]['relations'][K] extends ContractReferenceRelation
    ? never
    : K;
}[keyof TModels[ModelName]['relations']];
