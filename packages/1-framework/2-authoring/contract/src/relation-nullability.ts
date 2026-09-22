import type {
  ApplicationDomain,
  ApplicationDomainNamespace,
  ContractModelBase,
  ContractRelation,
  ContractToOneRelation,
} from '@internal/contract/types';

export type ToOneRelationNullabilityContradiction = 'declared-optional' | 'declared-required';

export type ToOneRelationNullability = {
  readonly nullable: boolean;
  readonly contradiction: ToOneRelationNullabilityContradiction | undefined;
};

/**
 * The one rule for whether a to-one relation may be absent. The side that holds the reference
 * (in SQL, the foreign key) is nullable exactly when one of its local fields is; the other side
 * is always nullable, because nothing in storage guarantees the related record exists. A
 * declaration that disagrees is reported as a contradiction; `nullable` is always the derived
 * value.
 */
export function resolveToOneRelationNullable(input: {
  readonly declaredNullable: boolean | undefined;
  readonly localFieldNullability: readonly boolean[];
  readonly ownsReference: boolean;
}): ToOneRelationNullability {
  const nullable = input.ownsReference ? input.localFieldNullability.some(Boolean) : true;
  const declared = input.declaredNullable;
  if (declared === undefined || declared === nullable) {
    return { nullable, contradiction: undefined };
  }
  return { nullable, contradiction: declared ? 'declared-optional' : 'declared-required' };
}

export type LocalFieldNullabilityLookup = (input: {
  readonly namespaceId: string;
  readonly modelName: string;
  readonly model: ContractModelBase;
  readonly relation: ContractToOneRelation;
}) => {
  readonly ownsReference: boolean;
  readonly localFieldNullability: readonly boolean[];
};

function isToOneReference(relation: ContractRelation): relation is ContractToOneRelation {
  return 'on' in relation && (relation.cardinality === '1:1' || relation.cardinality === 'N:1');
}

/**
 * Fills in `nullable` on every same-space to-one relation that lacks it from the ownership and
 * local-field nullability the lookup reports. A cross-space relation defaults to nullable.
 * Relations that already carry the flag are left as they are.
 */
export function withDerivedToOneRelationNullability<TDomain extends ApplicationDomain>(
  domain: TDomain,
  localFieldNullability: LocalFieldNullabilityLookup,
): TDomain {
  const namespaces = Object.fromEntries(
    Object.entries(domain.namespaces).map(([namespaceId, namespace]) => [
      namespaceId,
      withDerivedNamespace(namespaceId, namespace, localFieldNullability),
    ]),
  );
  return { ...domain, namespaces };
}

function withDerivedNamespace(
  namespaceId: string,
  namespace: ApplicationDomainNamespace,
  localFieldNullability: LocalFieldNullabilityLookup,
): ApplicationDomainNamespace {
  const models = Object.fromEntries(
    Object.entries(namespace.models).map(([modelName, model]) => [
      modelName,
      withDerivedModel(namespaceId, modelName, model, localFieldNullability),
    ]),
  );
  return { ...namespace, models };
}

function withDerivedModel(
  namespaceId: string,
  modelName: string,
  model: ContractModelBase,
  localFieldNullability: LocalFieldNullabilityLookup,
): ContractModelBase {
  const relations = Object.fromEntries(
    Object.entries(model.relations ?? {}).map(([relationName, relation]) => {
      if (!isToOneReference(relation) || relation.nullable !== undefined) {
        return [relationName, relation];
      }
      const nullable =
        relation.to.space !== undefined
          ? true
          : resolveToOneRelationNullable({
              declaredNullable: undefined,
              ...localFieldNullability({ namespaceId, modelName, model, relation }),
            }).nullable;
      return [relationName, { ...relation, nullable }];
    }),
  );
  return { ...model, relations };
}
