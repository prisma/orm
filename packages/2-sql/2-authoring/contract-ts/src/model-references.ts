import type { ContractDefinition, ModelNode } from './contract-definition';
import { contractError } from './contract-errors';

/** The declaration a reference starts from: a model, or a table node. Named in the errors that resolving the reference raises. */
export type ReferenceOwner =
  | { readonly kind: 'model'; readonly modelName: string }
  | { readonly kind: 'table'; readonly tableName: string };

export function referenceOwnerSubject(owner: ReferenceOwner): string {
  return owner.kind === 'model' ? `model "${owner.modelName}"` : `table "${owner.tableName}"`;
}

export function referenceOwnerMeta(owner: ReferenceOwner): Record<string, string> {
  return owner.kind === 'model'
    ? { sourceModel: owner.modelName }
    : { sourceTable: owner.tableName };
}

export function assertKnownTargetModel(
  modelsByName: ReadonlyMap<string, ModelNode>,
  modelsByCoordinate: ReadonlyMap<string, ModelNode>,
  owner: ReferenceOwner,
  targetModelName: string,
  targetNamespaceId: string | undefined,
  context: string,
): ModelNode {
  const targetModel =
    targetNamespaceId !== undefined && targetNamespaceId.length > 0
      ? modelsByCoordinate.get(`${targetNamespaceId}:${targetModelName}`)
      : modelsByName.get(targetModelName);
  if (!targetModel) {
    const qualified =
      targetNamespaceId !== undefined && targetNamespaceId.length > 0
        ? `${targetNamespaceId}.${targetModelName}`
        : targetModelName;
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `${context} on ${referenceOwnerSubject(owner)} references unknown model "${qualified}"`,
      { meta: { ...referenceOwnerMeta(owner), targetModel: qualified, context } },
    );
  }
  return targetModel;
}

export function assertTargetTableMatches(
  owner: ReferenceOwner,
  targetModel: ModelNode,
  referencedTableName: string,
  context: string,
): void {
  if (targetModel.tableName !== referencedTableName) {
    throw contractError(
      'CONTRACT.TABLE_MISMATCH',
      `${context} on ${referenceOwnerSubject(owner)} references table "${referencedTableName}" but model "${targetModel.modelName}" maps to "${targetModel.tableName}"`,
      {
        meta: {
          ...referenceOwnerMeta(owner),
          referencedTable: referencedTableName,
          mappedTable: targetModel.tableName,
          context,
        },
      },
    );
  }
}

/** The definition's models, indexed for resolving the references one model makes to another. */
export interface ModelLookups {
  readonly defaultNamespaceId: string;
  readonly modelsByName: ReadonlyMap<string, ModelNode>;
  readonly modelsByCoordinate: ReadonlyMap<string, ModelNode>;
  readonly tableNamespaceByName: ReadonlyMap<string, string>;
}

export function modelNamespaceId(model: ModelNode, defaultNamespaceId: string): string {
  return model.namespaceId !== undefined && model.namespaceId.length > 0
    ? model.namespaceId
    : defaultNamespaceId;
}

export function modelLookupsOf(definition: ContractDefinition): ModelLookups {
  const defaultNamespaceId = definition.target.defaultNamespaceId;
  const { models } = definition;
  return {
    defaultNamespaceId,
    modelsByName: new Map(models.map((m) => [m.modelName, m])),
    modelsByCoordinate: new Map(
      models.map((m) => [`${modelNamespaceId(m, defaultNamespaceId)}:${m.modelName}`, m]),
    ),
    tableNamespaceByName: new Map(
      models.map((m) => [m.tableName, modelNamespaceId(m, defaultNamespaceId)]),
    ),
  };
}
