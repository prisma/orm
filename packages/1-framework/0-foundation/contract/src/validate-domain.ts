import { ContractValidationError } from './contract-validation-error';
import type { CrossReference } from './cross-reference';
import type { ContractWithDomain } from './domain-envelope';
import { asNamespaceId, type NamespaceId } from './namespace-id';

export interface DomainRelationShape {
  readonly to: CrossReference;
  readonly cardinality?: string;
  readonly on?: unknown;
  readonly nullable?: unknown;
}

export interface DomainModelShape {
  readonly fields: Record<string, unknown>;
  readonly relations?: Record<string, DomainRelationShape>;
  readonly discriminator?: { readonly field: string };
  readonly variants?: Record<string, unknown>;
  readonly base?: CrossReference;
  readonly owner?: string;
}

export interface DomainContractShape extends ContractWithDomain {
  readonly roots: Record<string, CrossReference>;
}

interface IndexedModel {
  readonly namespaceId: NamespaceId;
  readonly name: string;
  readonly model: DomainModelShape;
}

type ModelIndex = Map<NamespaceId, Map<string, IndexedModel>>;

function indexDomainModels(contract: DomainContractShape): ModelIndex {
  const index: ModelIndex = new Map();
  for (const [namespaceKey, namespace] of Object.entries(contract.domain.namespaces)) {
    const namespaceId = asNamespaceId(namespaceKey);
    let modelsInNamespace = index.get(namespaceId);
    if (modelsInNamespace === undefined) {
      modelsInNamespace = new Map();
      index.set(namespaceId, modelsInNamespace);
    }
    for (const [name, model] of Object.entries(namespace.models)) {
      modelsInNamespace.set(name, { namespaceId, name, model });
    }
  }
  return index;
}

function lookupModel(index: ModelIndex, ref: CrossReference): IndexedModel | undefined {
  return index.get(ref.namespace)?.get(ref.model);
}

function* iterateIndexedModels(index: ModelIndex): IterableIterator<IndexedModel> {
  for (const modelsInNamespace of index.values()) {
    for (const entry of modelsInNamespace.values()) {
      yield entry;
    }
  }
}

export function validateContractDomain(contract: DomainContractShape): void {
  const errors: string[] = [];
  const modelIndex = indexDomainModels(contract);

  validateRoots(contract, modelIndex, errors);
  validateVariantsAndBases(modelIndex, errors);
  validateRelationTargets(modelIndex, errors);
  validateRelationNullability(modelIndex, errors);
  validateDiscriminators(modelIndex, errors);
  validateOwnership(contract, modelIndex, errors);
  validateValueObjectReferences(contract, errors);
  validateFieldModifiers(modelIndex, contract, errors);

  if (errors.length > 0) {
    throw new ContractValidationError(
      `Contract domain validation failed:\n- ${errors.join('\n- ')}`,
      'domain',
    );
  }
}

function validateRoots(
  contract: DomainContractShape,
  modelIndex: ModelIndex,
  errors: string[],
): void {
  const seenRootTargets = new Map<NamespaceId, Set<string>>();
  for (const [rootKey, crossRef] of Object.entries(contract.roots)) {
    let modelsInNamespace = seenRootTargets.get(crossRef.namespace);
    if (modelsInNamespace === undefined) {
      modelsInNamespace = new Set();
      seenRootTargets.set(crossRef.namespace, modelsInNamespace);
    }
    if (modelsInNamespace.has(crossRef.model)) {
      errors.push(
        `Duplicate root value: "${crossRef.namespace}:${crossRef.model}" is mapped by multiple root keys`,
      );
    }
    modelsInNamespace.add(crossRef.model);

    if (!lookupModel(modelIndex, crossRef)) {
      errors.push(
        `Root "${rootKey}" references model "${crossRef.namespace}:${crossRef.model}" which does not exist in domain.namespaces`,
      );
    }
  }
}

function validateVariantsAndBases(modelIndex: ModelIndex, errors: string[]): void {
  for (const { namespaceId, name: modelName, model } of iterateIndexedModels(modelIndex)) {
    if (model.variants) {
      for (const variantName of Object.keys(model.variants)) {
        const variantRef: CrossReference = { namespace: namespaceId, model: variantName };
        const variantEntry = lookupModel(modelIndex, variantRef);
        if (!variantEntry) {
          errors.push(
            `Model "${namespaceId}:${modelName}" lists variant "${variantName}" which does not exist at that namespace coordinate`,
          );
          continue;
        }
        const variantBase = variantEntry.model.base;
        if (variantBase?.namespace !== namespaceId || variantBase?.model !== modelName) {
          errors.push(
            `Variant "${namespaceId}:${variantName}" has base "${variantBase?.namespace ?? '?'}:${variantBase?.model ?? '(none)'}" but expected "${namespaceId}:${modelName}"`,
          );
        }
      }
    }

    if (model.base) {
      const baseEntry = lookupModel(modelIndex, model.base);
      if (!baseEntry) {
        errors.push(
          `Model "${namespaceId}:${modelName}" has base "${model.base.namespace}:${model.base.model}" which does not exist in domain.namespaces`,
        );
        continue;
      }
      if (!baseEntry.model.variants || !Object.hasOwn(baseEntry.model.variants, modelName)) {
        errors.push(
          `Model "${namespaceId}:${modelName}" has base "${model.base.namespace}:${model.base.model}" which does not list it as a variant`,
        );
      }
    }
  }
}

function validateRelationTargets(modelIndex: ModelIndex, errors: string[]): void {
  for (const { namespaceId, name: modelName, model } of iterateIndexedModels(modelIndex)) {
    for (const [relName, relation] of Object.entries(model.relations ?? {})) {
      // Cross-space relations (relation.to.space is defined) target a model in a
      // different contract space. The local domain index only contains this
      // contract's own models, so the target is intentionally absent here.
      // Existence of the target is verified by the aggregate verifier at
      // deploy time (after the spaces are composed), not at parse time.
      if (relation.to.space !== undefined) continue;
      if (!lookupModel(modelIndex, relation.to)) {
        errors.push(
          `Relation "${relName}" on model "${namespaceId}:${modelName}" targets "${relation.to.namespace}:${relation.to.model}" which does not exist in domain.namespaces`,
        );
      }
    }
  }
}

function relationKindLabel(relation: DomainRelationShape): string {
  return relation.on === undefined ? 'embed relation' : `${relation.cardinality} relation`;
}

function validateRelationNullability(modelIndex: ModelIndex, errors: string[]): void {
  for (const { namespaceId, name: modelName, model } of iterateIndexedModels(modelIndex)) {
    for (const [relName, relation] of Object.entries(model.relations ?? {})) {
      const location = `Relation "${relName}" on model "${namespaceId}:${modelName}"`;
      const isToOneReference =
        relation.on !== undefined &&
        (relation.cardinality === '1:1' || relation.cardinality === 'N:1');
      if (isToOneReference) {
        if (relation.nullable !== undefined && typeof relation.nullable !== 'boolean') {
          errors.push(
            `${location} is a ${relation.cardinality} relation and its "nullable" must be a boolean`,
          );
        }
        continue;
      }
      if (relation.nullable !== undefined) {
        errors.push(
          `${location} is a ${relationKindLabel(relation)} and must not carry "nullable"`,
        );
      }
    }
  }
}

function validateDiscriminators(modelIndex: ModelIndex, errors: string[]): void {
  for (const { namespaceId, name: modelName, model } of iterateIndexedModels(modelIndex)) {
    if (model.discriminator) {
      if (!model.variants || Object.keys(model.variants).length === 0) {
        errors.push(`Model "${namespaceId}:${modelName}" has discriminator but no variants`);
      }
      if (!Object.hasOwn(model.fields, model.discriminator.field)) {
        errors.push(
          `Discriminator field "${model.discriminator.field}" is not a field on model "${namespaceId}:${modelName}"`,
        );
      }
    }

    if (model.variants && Object.keys(model.variants).length > 0 && !model.discriminator) {
      errors.push(`Model "${namespaceId}:${modelName}" has variants but no discriminator`);
    }

    if (model.base) {
      if (model.discriminator) {
        errors.push(`Model "${namespaceId}:${modelName}" has base and must not have discriminator`);
      }
      if (model.variants && Object.keys(model.variants).length > 0) {
        errors.push(`Model "${namespaceId}:${modelName}" has base and must not have variants`);
      }
    }
  }
}

function validateOwnership(
  contract: DomainContractShape,
  modelIndex: ModelIndex,
  errors: string[],
): void {
  for (const { namespaceId, name: modelName, model } of iterateIndexedModels(modelIndex)) {
    if (!model.owner) continue;

    if (model.owner === modelName) {
      errors.push(`Model "${namespaceId}:${modelName}" cannot own itself`);
    }

    const ownerRef: CrossReference = { namespace: namespaceId, model: model.owner };
    if (!lookupModel(modelIndex, ownerRef)) {
      errors.push(
        `Model "${namespaceId}:${modelName}" has owner "${namespaceId}:${model.owner}" which does not exist in domain.namespaces`,
      );
    }

    for (const [rootKey, rootRef] of Object.entries(contract.roots)) {
      if (rootRef.namespace === namespaceId && rootRef.model === modelName) {
        errors.push(
          `Owned model "${namespaceId}:${modelName}" must not appear in roots (found as root "${rootKey}")`,
        );
      }
    }
  }
}

interface FieldTypeLike {
  readonly kind?: string;
  readonly name?: string;
  readonly members?: readonly FieldTypeLike[];
}

interface FieldLike {
  readonly type?: FieldTypeLike;
  readonly many?: boolean;
  readonly dict?: boolean;
}

function validateValueObjectReferences(contract: DomainContractShape, errors: string[]): void {
  const voNamesByNamespace = new Map<NamespaceId, Set<string>>();
  for (const [namespaceKey, namespace] of Object.entries(contract.domain.namespaces)) {
    const namespaceId = asNamespaceId(namespaceKey);
    voNamesByNamespace.set(namespaceId, new Set(Object.keys(namespace.valueObjects ?? {})));
  }

  function checkType(
    type: FieldTypeLike | undefined,
    location: string,
    namespaceId: NamespaceId,
  ): void {
    if (!type) return;
    const voNames = voNamesByNamespace.get(namespaceId) ?? new Set<string>();
    if (type.kind === 'valueObject' && type.name && !voNames.has(type.name)) {
      errors.push(
        `${location} references value object "${namespaceId}:${type.name}" which does not exist in that namespace's valueObjects`,
      );
      return;
    }
    if (type.kind === 'union') {
      for (const member of type.members ?? []) checkType(member, location, namespaceId);
    }
  }

  for (const [namespaceKey, namespace] of Object.entries(contract.domain.namespaces)) {
    const namespaceId = asNamespaceId(namespaceKey);
    for (const [modelName, model] of Object.entries(namespace.models)) {
      for (const [fieldName, field] of Object.entries(model.fields)) {
        const f = field as FieldLike | undefined;
        checkType(f?.type, `Model "${namespaceId}:${modelName}" field "${fieldName}"`, namespaceId);
      }
    }
    for (const [voName, vo] of Object.entries(namespace.valueObjects ?? {})) {
      for (const [fieldName, field] of Object.entries(vo.fields)) {
        const f = field as FieldLike | undefined;
        checkType(
          f?.type,
          `Value object "${namespaceId}:${voName}" field "${fieldName}"`,
          namespaceId,
        );
      }
    }
  }
}

function validateFieldModifiers(
  modelIndex: ModelIndex,
  contract: DomainContractShape,
  errors: string[],
): void {
  for (const { namespaceId, name: modelName, model } of iterateIndexedModels(modelIndex)) {
    for (const [fieldName, field] of Object.entries(model.fields)) {
      const f = field as FieldLike | undefined;
      if (f?.many && f?.dict) {
        errors.push(
          `Model "${namespaceId}:${modelName}" field "${fieldName}" cannot have both "many" and "dict" modifiers`,
        );
      }
    }
  }
  for (const [namespaceKey, namespace] of Object.entries(contract.domain.namespaces)) {
    const namespaceId = asNamespaceId(namespaceKey);
    for (const [voName, vo] of Object.entries(namespace.valueObjects ?? {})) {
      for (const [fieldName, field] of Object.entries(vo.fields)) {
        const f = field as FieldLike | undefined;
        if (f?.many && f?.dict) {
          errors.push(
            `Value object "${namespaceId}:${voName}" field "${fieldName}" cannot have both "many" and "dict" modifiers`,
          );
        }
      }
    }
  }
}
