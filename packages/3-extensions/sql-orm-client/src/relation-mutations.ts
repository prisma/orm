import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import {
  columnOfContractField,
  fieldOfColumn,
  getModelColumnFields,
  resolveModelRelations,
  resolveModelTableName,
  resolveRelationTargetColumns,
} from './collection-contract';
import { ormError } from './orm-errors';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
} from './relation-mutator';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  RelationCardinalityTag,
  RelationMutation,
} from './types';

export interface JunctionThrough {
  readonly table: string;
  readonly namespaceId: string;
  readonly parentColumns: readonly string[];
  readonly childColumns: readonly string[];
  readonly targetColumns: readonly string[];
  readonly requiredPayloadColumns: readonly string[];
}

export interface RelationDefinition {
  readonly relationName: string;
  readonly relatedModelName: string;
  readonly relatedNamespaceId: string;
  readonly relatedTableName: string;
  readonly cardinality: RelationCardinalityTag | undefined;
  readonly localColumns: readonly string[];
  readonly targetColumns: readonly string[];
  readonly through: JunctionThrough | undefined;
}

export interface JunctionRelationDefinition extends RelationDefinition {
  readonly through: JunctionThrough;
}

export function hasThrough(relation: RelationDefinition): relation is JunctionRelationDefinition {
  return relation.through !== undefined;
}

export interface ParsedRelationMutation {
  readonly relation: RelationDefinition;
  readonly mutation: RelationMutation<Contract<SqlStorage>, string>;
}

export interface ParsedMutationInput {
  readonly scalarData: Record<string, unknown>;
  readonly relationMutations: readonly ParsedRelationMutation[];
}

export function parseMutationInput(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  input:
    | MutationCreateInput<Contract<SqlStorage>, string>
    | MutationUpdateInput<Contract<SqlStorage>, string>,
): ParsedMutationInput {
  const scalarData: Record<string, unknown> = {};
  const relationDefinitions = new Map(
    getRelationDefinitions(contract, namespaceId, modelName).map((relation) => [
      relation.relationName,
      relation,
    ]),
  );

  const relationMutations: ParsedRelationMutation[] = [];

  for (const [fieldName, value] of Object.entries(input)) {
    const relation = relationDefinitions.get(fieldName);
    if (!relation) {
      scalarData[fieldName] = value;
      continue;
    }
    if (value === undefined) {
      continue;
    }

    if (!isRelationMutationCallback(value)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `Relation field "${fieldName}" on model "${modelName}" expects a mutator callback`,
        { meta: { relation: fieldName, model: modelName, problem: 'missing-callback' } },
      );
    }

    const mutator = createRelationMutator<Contract<SqlStorage>, string>();
    const mutation = value(mutator);
    if (!isRelationMutationDescriptor(mutation)) {
      throw ormError(
        'ORM.RELATION_MUTATION_INVALID',
        `Relation field "${fieldName}" on model "${modelName}" returned an invalid mutation descriptor`,
        { meta: { relation: fieldName, model: modelName, problem: 'invalid-descriptor' } },
      );
    }

    relationMutations.push({
      relation,
      mutation,
    });
  }

  return {
    scalarData,
    relationMutations,
  };
}

export interface JunctionParsedRelationMutation extends ParsedRelationMutation {
  readonly relation: JunctionRelationDefinition;
}

export function partitionByOwnership(relationMutations: readonly ParsedRelationMutation[]): {
  parentOwned: ParsedRelationMutation[];
  childOwned: ParsedRelationMutation[];
  junctionOwned: JunctionParsedRelationMutation[];
} {
  const parentOwned: ParsedRelationMutation[] = [];
  const childOwned: ParsedRelationMutation[] = [];
  const junctionOwned: JunctionParsedRelationMutation[] = [];

  for (const relationMutation of relationMutations) {
    if (hasThrough(relationMutation.relation)) {
      junctionOwned.push({
        relation: relationMutation.relation,
        mutation: relationMutation.mutation,
      });
      continue;
    }

    if (relationMutation.relation.cardinality === 'N:1') {
      parentOwned.push(relationMutation);
      continue;
    }

    childOwned.push(relationMutation);
  }

  return {
    parentOwned,
    childOwned,
    junctionOwned,
  };
}

export function assertJunctionPayloadWritable(
  relation: JunctionRelationDefinition,
  mutationKind: RelationMutation<Contract<SqlStorage>, string>['kind'],
): void {
  const through = relation.through;
  if (
    (mutationKind !== 'create' && mutationKind !== 'connect') ||
    through.requiredPayloadColumns.length === 0
  ) {
    return;
  }

  const cols = through.requiredPayloadColumns.map((c) => `\`${c}\``).join(', ');
  throw ormError(
    'ORM.RELATION_MUTATION_UNSUPPORTED',
    `Cannot \`${mutationKind}\` on relation \`${relation.relationName}\`: its junction \`${through.table}\` has required column(s) ${cols} the relation API can't populate. Write the \`${through.table}\` junction directly or use the SQL builder.`,
    {
      meta: {
        kind: mutationKind,
        relation: relation.relationName,
        reason: 'junction-required-columns',
        junction: through.table,
      },
    },
  );
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

export function assertJunctionMetadataShape(relation: JunctionRelationDefinition): void {
  assertJunctionParentMetadataLength(relation);
  assertJunctionTargetMetadataLength(relation);
}

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
  const definitions = Object.entries(relations).map(([relationName, relation]) => ({
    relationName,
    relatedModelName: relation.to,
    relatedNamespaceId: relation.toNamespace,
    relatedTableName: resolveModelTableName(contract, relation.toNamespace, relation.to),
    cardinality: relation.cardinality,
    localColumns: relation.on.localFields.map((f) =>
      columnOfContractField(contract, namespaceId, modelName, f),
    ),
    targetColumns: resolveRelationTargetColumns(contract, relation),
    through: relation.through
      ? {
          table: relation.through.table,
          namespaceId: relation.through.namespaceId,
          parentColumns: relation.through.parentColumns,
          childColumns: relation.through.childColumns,
          targetColumns: relation.through.targetColumns,
          requiredPayloadColumns: relation.through.requiredPayloadColumns,
        }
      : undefined,
  }));

  perContract.set(cacheKey, definitions);
  return definitions;
}

export function toFieldName(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  columnName: string,
): string {
  return fieldOfColumn(
    getModelColumnFields(contract, namespaceId, modelName),
    modelName,
    columnName,
  );
}

export function hasRelationFields(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  data: Readonly<Record<string, unknown>>,
): boolean {
  const relationNames = Object.keys(resolveModelRelations(contract, namespaceId, modelName));
  return relationNames.some((name) => data[name] !== undefined);
}

export function hasNestedMutationCallbacks(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  data: Record<string, unknown>,
): boolean {
  const relationNames = new Set(
    Object.keys(resolveModelRelations(contract, namespaceId, modelName)),
  );
  return Object.entries(data).some(
    ([fieldName, value]) => relationNames.has(fieldName) && isRelationMutationCallback(value),
  );
}
