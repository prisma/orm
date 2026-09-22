import type { ContractModelBase, ContractToOneRelation } from '@internal/contract/types';

export type MongoToOneRelationFields = {
  /** False for the back side of a 1:1, whose local field is the document id. */
  readonly ownsForeignKey: boolean;
  /** One entry per local field; a field the model does not declare counts as nullable. */
  readonly fields: readonly { readonly name: string; readonly nullable: boolean }[];
};

const DOCUMENT_ID_FIELD = '_id';

/**
 * The model facts behind a same-space to-one relation's nullability: which side owns the
 * foreign key, and whether each local field is nullable.
 */
export function resolveMongoToOneRelationFields(
  model: ContractModelBase,
  relation: ContractToOneRelation,
): MongoToOneRelationFields {
  const fields = relation.on.localFields.map((name) => ({
    name,
    nullable: model.fields[name]?.nullable ?? true,
  }));
  const ownsForeignKey = !(
    relation.cardinality === '1:1' && fields.every((field) => field.name === DOCUMENT_ID_FIELD)
  );
  return { ownsForeignKey, fields };
}
