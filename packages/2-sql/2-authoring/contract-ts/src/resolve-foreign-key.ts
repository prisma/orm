import { asNamespaceId } from '@internal/contract/types';
import type { ForeignKeyDefaultsState } from '@internal/contract-authoring';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import { applyFkDefaults } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import type { ForeignKeyNode } from './contract-definition';
import {
  assertKnownTargetModel,
  assertTargetTableMatches,
  type ModelLookups,
  modelNamespaceId,
} from './model-references';

/** The table a foreign key starts from, and the name its errors give the declaration that owns it. */
export interface ForeignKeySourceTable {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly ownerName: string;
}

export interface ForeignKeyResolutionContext extends ModelLookups {
  readonly foreignKeyDefaults: ForeignKeyDefaultsState | undefined;
}

/** Resolves a foreign key's target. A cross-space key keeps its foreign space; a local key must name a model of this definition and that model's table. */
export function resolveForeignKey(
  fk: ForeignKeyNode,
  sourceTable: ForeignKeySourceTable,
  context: ForeignKeyResolutionContext,
): ForeignKeyAuthoringInput {
  const source = {
    namespaceId: asNamespaceId(sourceTable.namespaceId),
    tableName: sourceTable.tableName,
    columns: fk.columns,
  };
  const options = {
    ...applyFkDefaults(
      {
        ...ifDefined('constraint', fk.constraint),
        ...ifDefined('index', fk.index),
      },
      context.foreignKeyDefaults,
    ),
    ...ifDefined('name', fk.name),
    ...ifDefined('onDelete', fk.onDelete),
    ...ifDefined('onUpdate', fk.onUpdate),
  };
  if (fk.references.spaceId !== undefined) {
    return {
      source,
      target: {
        namespaceId: asNamespaceId(fk.references.namespaceId ?? context.defaultNamespaceId),
        tableName: fk.references.table,
        columns: fk.references.columns,
        spaceId: fk.references.spaceId,
      },
      ...options,
    };
  }

  const targetModel = assertKnownTargetModel(
    context.modelsByName,
    context.modelsByCoordinate,
    sourceTable.ownerName,
    fk.references.model,
    fk.references.namespaceId,
    'Foreign key',
  );
  assertTargetTableMatches(sourceTable.ownerName, targetModel, fk.references.table, 'Foreign key');
  return {
    source,
    target: {
      namespaceId: asNamespaceId(
        fk.references.namespaceId ?? modelNamespaceId(targetModel, context.defaultNamespaceId),
      ),
      tableName: fk.references.table,
      columns: fk.references.columns,
    },
    ...options,
  };
}
