import {
  type ContractRelation,
  type ContractRelationThrough,
  crossRef,
} from '@internal/contract/types';
import { resolveToOneRelationNullable } from '@internal/contract-authoring';
import { invariant } from '@internal/utils/assertions';
import type { ModelNode, RelationNode } from './contract-definition';
import { contractError } from './contract-errors';
import {
  assertKnownTargetModel,
  assertTargetTableMatches,
  type ModelLookups,
  modelNamespaceId,
} from './model-references';
import { toOneNullabilityContradictionMessage } from './to-one-nullability-message';

function toOneRelationNullable(semanticModel: ModelNode, relation: RelationNode): boolean {
  const location = `Relation "${semanticModel.modelName}.${relation.fieldName}"`;
  if (relation.nullable === undefined) {
    throw contractError(
      'CONTRACT.RELATION_INVALID',
      `${location} with cardinality "${relation.cardinality}" must state whether it is nullable`,
      {
        meta: {
          modelName: semanticModel.modelName,
          relationName: relation.fieldName,
          reason: 'to-one-nullability-missing',
        },
      },
    );
  }
  const localColumns = relation.on.parentColumns;
  const { contradiction } = resolveToOneRelationNullable({
    declaredNullable: relation.nullable,
    localFieldNullability: semanticModel.fields
      .filter((field) => localColumns.includes(field.columnName))
      .map((field) => field.nullable),
    ownsReference: relation.cardinality === 'N:1',
  });
  if (contradiction !== undefined) {
    throw contractError(
      'CONTRACT.RELATION_INVALID',
      relation.cardinality === 'N:1'
        ? toOneNullabilityContradictionMessage(location, contradiction)
        : `${location} is required but does not own the foreign key, so nothing in storage guarantees the related row exists`,
      {
        meta: {
          modelName: semanticModel.modelName,
          relationName: relation.fieldName,
          reason: 'to-one-nullability-mismatch',
        },
      },
    );
  }
  return relation.nullable;
}

function buildThroughDescriptor(
  through: NonNullable<RelationNode['through']>,
  tableNamespaceByName: ReadonlyMap<string, string>,
  targetModel: ModelNode,
  modelName: string,
  fieldName: string,
  defaultNamespaceId: string,
): ContractRelationThrough {
  if (!tableNamespaceByName.has(through.table)) {
    throw contractError(
      'CONTRACT.MODEL_UNKNOWN',
      `buildSqlContractFromDefinition: junction table "${through.table}" for relation "${modelName}.${fieldName}" is not a declared model.`,
      { meta: { sourceModel: modelName, relationName: fieldName, junctionTable: through.table } },
    );
  }
  // Junction table names are unique per namespace, not globally. Prefer the
  // junction's own declared namespace (carried on the through node); fall back to
  // the target's default namespace. Resolving by bare table name would pick the
  // wrong namespace when the same junction table name exists in two namespaces.
  const namespaceId = through.namespaceId ?? defaultNamespaceId;

  return {
    table: through.table,
    namespaceId,
    parentColumns: through.parentColumns,
    childColumns: through.childColumns,
    targetColumns: targetColumnsForJunction(targetModel, fieldName),
  };
}

function targetColumnsForJunction(targetModel: ModelNode, fieldName: string): readonly string[] {
  const primaryKeyColumns = targetModel.id?.columns;
  if (primaryKeyColumns && primaryKeyColumns.length > 0) {
    return primaryKeyColumns;
  }
  const firstUnique = targetModel.uniques?.find((u) => u.columns.length > 0);
  if (firstUnique) {
    return firstUnique.columns;
  }
  throw contractError(
    'CONTRACT.IDENTITY_INVALID',
    `M:N target model "${targetModel.modelName}" (relation field "${fieldName}") has no primary id or unique key to derive junction targetColumns.`,
    { meta: { modelName: targetModel.modelName, reason: 'no-key-for-junction-target-columns' } },
  );
}

/** The field of `model` that maps a relation's join column. A relation joins on fields, so a column no field maps is refused. */
function joinFieldOf(
  owner: ModelNode,
  relation: RelationNode,
  model: ModelNode,
  columnToField: ReadonlyMap<string, string>,
  column: string,
): string {
  const field = columnToField.get(column);
  if (field !== undefined) return field;
  throw contractError(
    'CONTRACT.RELATION_INVALID',
    `Relation "${owner.modelName}.${relation.fieldName}" joins on column "${column}" of table "${model.tableName}", which no field of model "${model.modelName}" maps. A relation joins on fields; declare a field for the column.`,
    {
      meta: {
        modelName: owner.modelName,
        relationName: relation.fieldName,
        column,
        reason: 'join-column-not-a-field',
      },
    },
  );
}

/** Lowers a model's relations. `columnToField` maps the model's columns to the fields that hold them. */
export function lowerRelations(
  semanticModel: ModelNode,
  columnToField: ReadonlyMap<string, string>,
  lookups: ModelLookups,
): Record<string, ContractRelation> {
  const { defaultNamespaceId } = lookups;
  const modelRelations: Record<string, ContractRelation> = {};
  for (const relation of semanticModel.relations ?? []) {
    // Cross-space relations have `spaceId` set — the target model lives in
    // a different contract space, so skip local model lookup and validation.
    if (relation.spaceId !== undefined) {
      const targetNamespaceId = relation.namespaceId ?? defaultNamespaceId;
      const localFields = relation.on.parentColumns.map((col) =>
        joinFieldOf(semanticModel, relation, semanticModel, columnToField, col),
      );
      modelRelations[relation.fieldName] = {
        to: crossRef(relation.toModel, targetNamespaceId, relation.spaceId),
        // Cross-space belongsTo relations are always N:1 (the FK-owning side).
        cardinality: 'N:1',
        nullable: toOneRelationNullable(semanticModel, relation),
        on: {
          localFields,
          // For cross-space targets the lowering carries field names directly
          // (no fieldToColumn map available for the remote model).
          targetFields: relation.on.childColumns,
        },
      };
      continue;
    }

    const owner = { kind: 'model', modelName: semanticModel.modelName } as const;
    const targetModel = assertKnownTargetModel(
      lookups.modelsByName,
      lookups.modelsByCoordinate,
      owner,
      relation.toModel,
      relation.toNamespaceId,
      'Relation',
    );
    invariant(
      relation.toTable !== undefined,
      `Relation "${semanticModel.modelName}.${relation.fieldName}" is local but carries no target table; only cross-space relations may leave it unset.`,
    );
    assertTargetTableMatches(owner, targetModel, relation.toTable, 'Relation');

    const targetColumnToField = new Map(targetModel.fields.map((f) => [f.columnName, f.fieldName]));

    const to = crossRef(
      relation.toModel,
      relation.toNamespaceId !== undefined && relation.toNamespaceId.length > 0
        ? relation.toNamespaceId
        : modelNamespaceId(targetModel, defaultNamespaceId),
    );
    const joinField = (
      model: ModelNode,
      fields: ReadonlyMap<string, string>,
      column: string,
    ): string => joinFieldOf(semanticModel, relation, model, fields, column);
    const on = {
      localFields: relation.on.parentColumns.map((col) =>
        joinField(semanticModel, columnToField, col),
      ),
      // A many-to-many relation names the junction table's columns on its target side.
      targetFields:
        relation.through !== undefined
          ? [...relation.on.childColumns]
          : relation.on.childColumns.map((col) => joinField(targetModel, targetColumnToField, col)),
    };

    if (relation.cardinality === 'N:M') {
      if (!relation.through) {
        throw contractError(
          'CONTRACT.RELATION_INVALID',
          `Relation "${semanticModel.modelName}.${relation.fieldName}" with cardinality "N:M" requires through metadata`,
          {
            meta: {
              modelName: semanticModel.modelName,
              relationName: relation.fieldName,
              reason: 'many-to-many-missing-through',
            },
          },
        );
      }
      modelRelations[relation.fieldName] = {
        to,
        cardinality: 'N:M',
        on,
        through: buildThroughDescriptor(
          relation.through,
          lookups.tableNamespaceByName,
          targetModel,
          semanticModel.modelName,
          relation.fieldName,
          defaultNamespaceId,
        ),
      };
    } else if (relation.cardinality === '1:N') {
      modelRelations[relation.fieldName] = { to, cardinality: '1:N', on };
    } else {
      modelRelations[relation.fieldName] = {
        to,
        cardinality: relation.cardinality,
        nullable: toOneRelationNullable(semanticModel, relation),
        on,
      };
    }
  }
  return modelRelations;
}
