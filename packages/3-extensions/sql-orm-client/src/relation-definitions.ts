import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import {
  hasContractCapability,
  hasUniqueKeyOverColumns,
  type ResolvedThrough,
  resolveFieldToColumn,
  resolveModelRelations,
  resolveModelTableName,
} from './collection-contract';
import type { RelationCardinalityTag } from './types';

export interface RelationDefinitionBase {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedNamespaceId: string;
  readonly relatedTableName: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly localColumns: readonly string[];
  readonly targetColumns: readonly string[];
}

export interface JunctionRelationDefinition extends RelationDefinitionBase {
  readonly through: ResolvedThrough;
}

export type RelationDefinition =
  | (RelationDefinitionBase & { readonly ownership: 'parent' })
  | (RelationDefinitionBase & { readonly ownership: 'child' })
  | JunctionRelation;

export interface JunctionRelation extends JunctionRelationDefinition {
  readonly ownership: 'junction';
  readonly connectConflictColumns: readonly string[] | undefined;
}

export type RelationOwnership = RelationDefinition['ownership'];

const relationDefsCache = new WeakMap<object, Map<string, RelationDefinition[]>>();

export function getRelationDefinitions(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
): RelationDefinition[] {
  let perContract = relationDefsCache.get(contract);
  if (!perContract) {
    perContract = new Map();
    relationDefsCache.set(contract, perContract);
  }
  const cacheKey = JSON.stringify([namespaceId, modelName]);
  const cached = perContract.get(cacheKey);
  if (cached) return cached;

  // The base model's relations resolve within its namespace; relation
  // targets resolve within the target model's namespace (`relation.toNamespace`,
  // carried by the cross-reference) so a cross-namespace relation does not
  // fall back to the default/first-match path.
  const relations = resolveModelRelations(contract, namespaceId, modelName);
  const definitions = Object.entries(relations).map(
    ([relationName, relation]): RelationDefinition => {
      const definition: RelationDefinitionBase = {
        relationName,
        relatedModelName: relation.to,
        relatedNamespaceId: relation.toNamespace,
        relatedTableName: resolveModelTableName(contract, relation.toNamespace, relation.to),
        cardinality: relation.cardinality,
        localColumns: relation.on.localFields.map((f) =>
          resolveFieldToColumn(contract, namespaceId, modelName, f),
        ),
        targetColumns: relation.on.targetFields.map((f) =>
          resolveFieldToColumn(contract, relation.toNamespace, relation.to, f),
        ),
      };
      if (relation.through) {
        const junction = { ...definition, through: relation.through };
        assertJunctionParentMetadataLength(junction);
        assertJunctionTargetMetadataLength(junction);
        const linkColumns = [
          ...new Set([...relation.through.parentColumns, ...relation.through.childColumns]),
        ];
        const skipsExistingLink =
          hasContractCapability(contract, 'insertOnConflictSkip') &&
          hasUniqueKeyOverColumns(
            contract,
            relation.through.namespaceId,
            relation.through.table,
            linkColumns,
          );
        return {
          ...junction,
          ownership: 'junction',
          connectConflictColumns: skipsExistingLink ? linkColumns : undefined,
        };
      }
      return {
        ...definition,
        ownership: relation.cardinality === 'N:1' ? 'parent' : 'child',
      };
    },
  );

  perContract.set(cacheKey, definitions);
  return definitions;
}

function assertJunctionMetadataLength(
  relation: JunctionRelationDefinition,
  throughColumnName: string,
  throughColumns: readonly string[],
  pairedColumnName: string,
  pairedColumns: readonly string[],
): void {
  if (throughColumns.length === pairedColumns.length) {
    return;
  }

  throw new InternalError(
    `Relation "${relation.relationName}" has invalid junction metadata: ${throughColumnName} has ${throughColumns.length} column(s), but ${pairedColumnName} has ${pairedColumns.length}`,
  );
}

export function assertJunctionParentMetadataLength(relation: JunctionRelationDefinition): void {
  assertJunctionMetadataLength(
    relation,
    'parentColumns',
    relation.through.parentColumns,
    'localColumns',
    relation.localColumns,
  );
}

export function assertJunctionTargetMetadataLength(relation: JunctionRelationDefinition): void {
  assertJunctionMetadataLength(
    relation,
    'childColumns',
    relation.through.childColumns,
    'targetColumns',
    relation.through.targetColumns,
  );
}
