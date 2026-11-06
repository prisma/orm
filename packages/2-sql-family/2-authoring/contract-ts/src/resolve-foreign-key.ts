import { asNamespaceId } from '@internal/contract/types';
import type { ForeignKeyDefaultsState } from '@internal/contract-authoring';
import type { ForeignKeyAuthoringInput } from '@internal/sql-contract/foreign-key-materialization';
import { applyFkDefaults } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import type { ForeignKeyNode } from './contract-definition';
import { contractError } from './contract-errors';
import {
  type ReferenceOwner,
  referenceOwnerMeta,
  referenceOwnerSubject,
} from './declaration-sites';
import {
  assertKnownTargetModel,
  assertTargetTableMatches,
  type ModelLookups,
  modelNamespaceId,
} from './model-references';
import { namespaceIdOrDefault } from './namespace-id';
import { tableKey } from './storage-description';

/** The table a foreign key starts from, and the declaration that owns it. */
export interface ForeignKeySourceTable {
  readonly namespaceId: string;
  readonly tableName: string;
  readonly owner: ReferenceOwner;
}

export interface ForeignKeyResolutionContext extends ModelLookups {
  readonly foreignKeyDefaults: ForeignKeyDefaultsState | undefined;
  /** Every table a model or a table node declares, by {@link tableKey}. */
  readonly declaredTables: ReadonlySet<string>;
}

/** Resolves a foreign key's target. A cross-space key keeps its foreign space; a local key names either a model of this definition and that model's table, or a table a model or table node declares. */
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

  const { references } = fk;
  if (references.model === undefined) {
    const namespaceId = namespaceIdOrDefault(references.namespaceId, context.defaultNamespaceId);
    if (!context.declaredTables.has(tableKey(namespaceId, references.table))) {
      throw contractError(
        'CONTRACT.TABLE_UNKNOWN',
        `Foreign key on ${referenceOwnerSubject(sourceTable.owner)} references table "${references.table}" in namespace "${namespaceId}", which no model or table node declares. Declare the table with a model or a table node, or correct the name.`,
        {
          meta: {
            ...referenceOwnerMeta(sourceTable.owner),
            referencedTable: references.table,
            namespaceId,
          },
        },
      );
    }
    return {
      source,
      target: {
        namespaceId: asNamespaceId(namespaceId),
        tableName: references.table,
        columns: references.columns,
      },
      ...options,
    };
  }

  const targetModel = assertKnownTargetModel(
    context.modelsByName,
    context.modelsByCoordinate,
    sourceTable.owner,
    references.model,
    fk.references.namespaceId,
    'Foreign key',
  );
  assertTargetTableMatches(sourceTable.owner, targetModel, fk.references.table, 'Foreign key');
  return {
    source,
    target: {
      namespaceId: asNamespaceId(
        namespaceIdOrDefault(
          fk.references.namespaceId,
          modelNamespaceId(targetModel, context.defaultNamespaceId),
        ),
      ),
      tableName: fk.references.table,
      columns: fk.references.columns,
    },
    ...options,
  };
}
