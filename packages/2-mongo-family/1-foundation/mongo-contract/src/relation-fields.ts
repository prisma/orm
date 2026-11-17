import type {
  ContractEmbedRelation,
  ContractModel,
  ContractRelation,
  ContractToOneRelation,
} from '@internal/contract/types';
import type { MongoModelStorage } from './contract-types';
import { DOCUMENT_ID, ownStoredNameOf } from './stored-names';

export type MongoToOneRelationFields = {
  /** False for the back side of a 1:1, whose local field is the document id. */
  readonly ownsForeignKey: boolean;
  /** One entry per local field; a field the model does not declare counts as nullable. */
  readonly fields: readonly { readonly name: string; readonly nullable: boolean }[];
};

/**
 * The model facts behind a same-space to-one relation's nullability: which side owns the
 * foreign key, and whether each local field is nullable.
 */
export function resolveMongoToOneRelationFields(
  model: ContractModel<MongoModelStorage>,
  relation: ContractToOneRelation,
): MongoToOneRelationFields {
  const fields = relation.on.localFields.map((name) => ({
    name,
    nullable: model.fields[name]?.nullable ?? true,
  }));
  const ownsForeignKey = !(
    relation.cardinality === '1:1' &&
    fields.every(
      (field) =>
        Object.hasOwn(model.fields, field.name) &&
        ownStoredNameOf(model, field.name) === DOCUMENT_ID,
    )
  );
  return { ownsForeignKey, fields };
}

/** Whether `relation` stores the related model inside the document, rather than referring to documents elsewhere. */
export function isEmbedRelation(relation: ContractRelation): relation is ContractEmbedRelation {
  return !('on' in relation) && !('through' in relation);
}
