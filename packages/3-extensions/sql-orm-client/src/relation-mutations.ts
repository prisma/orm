import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { InternalError } from '@internal/utils/internal-error';
import {
  type ResolvedRelation,
  type ResolvedThrough,
  resolveModelRelations,
} from './collection-contract';
import { ormError } from './orm-errors';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
} from './relation-mutator';
import type { MutationCreateInput, MutationUpdateInput, RelationMutation } from './types';

export interface JunctionRelation extends ResolvedRelation {
  readonly through: ResolvedThrough;
}

export function hasThrough(relation: ResolvedRelation): relation is JunctionRelation {
  return relation.through !== undefined;
}

export interface ParsedRelationMutation {
  readonly name: string;
  readonly relation: ResolvedRelation;
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
  const relations = resolveModelRelations(contract, namespaceId, modelName);

  const relationMutations: ParsedRelationMutation[] = [];

  for (const [fieldName, value] of Object.entries(input)) {
    const relation = Object.hasOwn(relations, fieldName) ? relations[fieldName] : undefined;
    if (relation === undefined) {
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

    relationMutations.push({ name: fieldName, relation, mutation });
  }

  return {
    scalarData,
    relationMutations,
  };
}

export interface JunctionRelationMutation extends ParsedRelationMutation {
  readonly relation: JunctionRelation;
}

export function partitionByOwnership(relationMutations: readonly ParsedRelationMutation[]): {
  parentOwned: ParsedRelationMutation[];
  childOwned: ParsedRelationMutation[];
  junctionOwned: JunctionRelationMutation[];
} {
  const parentOwned: ParsedRelationMutation[] = [];
  const childOwned: ParsedRelationMutation[] = [];
  const junctionOwned: JunctionRelationMutation[] = [];

  for (const relationMutation of relationMutations) {
    if (hasThrough(relationMutation.relation)) {
      junctionOwned.push({ ...relationMutation, relation: relationMutation.relation });
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

export function assertJunctionPayloadWritable({
  name,
  relation,
  mutation,
}: JunctionRelationMutation): void {
  const { through } = relation;
  if (
    (mutation.kind !== 'create' && mutation.kind !== 'connect') ||
    through.requiredPayloadColumns.length === 0
  ) {
    return;
  }

  const cols = through.requiredPayloadColumns.map((c) => `\`${c}\``).join(', ');
  throw ormError(
    'ORM.RELATION_MUTATION_UNSUPPORTED',
    `Cannot \`${mutation.kind}\` on relation \`${name}\`: its junction \`${through.table}\` has required column(s) ${cols} the relation API can't populate. Write the \`${through.table}\` junction directly or use the SQL builder.`,
    {
      meta: {
        kind: mutation.kind,
        relation: name,
        reason: 'junction-required-columns',
        junction: through.table,
      },
    },
  );
}

function assertJunctionMetadataLength(
  name: string,
  throughColumnName: string,
  throughColumns: readonly string[],
  pairedColumnName: string,
  pairedColumns: readonly string[],
): void {
  if (throughColumns.length === pairedColumns.length) {
    return;
  }

  throw new InternalError(
    `Relation "${name}" has invalid junction metadata: ${throughColumnName} has ${throughColumns.length} column(s), but ${pairedColumnName} has ${pairedColumns.length}`,
  );
}

export function assertJunctionMetadataShape({ name, relation }: JunctionRelationMutation): void {
  assertJunctionMetadataLength(
    name,
    'parentColumns',
    relation.through.parentColumns,
    'localColumns',
    relation.on.localFields,
  );
  assertJunctionMetadataLength(
    name,
    'childColumns',
    relation.through.childColumns,
    'targetColumns',
    relation.through.targetColumns,
  );
}
