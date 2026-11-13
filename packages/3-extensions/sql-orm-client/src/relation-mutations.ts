import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import { InternalError } from '@internal/utils/internal-error';
import {
  getModelFieldColumns,
  modelOf,
  type ResolvedRelation,
  type ResolvedThrough,
  resolveModelRelations,
  resolvePolymorphismInfo,
} from './collection-contract';
import { ormError } from './orm-errors';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
  type RelationCollection,
} from './relation-mutator';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  NestedCreateOptions,
  RelationMutation,
} from './types';

export interface JunctionRelation extends ResolvedRelation {
  readonly through: ResolvedThrough;
}

export function hasThrough(relation: ResolvedRelation): relation is JunctionRelation {
  return relation.through !== undefined;
}

export interface ParsedRelationMutation {
  readonly name: string;
  readonly relation: ResolvedRelation;
  readonly mutations: readonly RelationMutation<Contract<SqlStorage>, string>[];
  readonly relatedCollection: RelatedCollection;
}

export interface ParsedMutationInput {
  readonly scalarData: Record<string, unknown>;
  readonly relationMutations: readonly ParsedRelationMutation[];
}

export type RelatedCollection = (
  relation: ResolvedRelation,
) => RelationCollection<Contract<SqlStorage>, string>;

export function parseMutationInput(
  contract: Contract<SqlStorage>,
  namespaceId: string,
  modelName: string,
  input:
    | MutationCreateInput<Contract<SqlStorage>, string>
    | MutationUpdateInput<Contract<SqlStorage>, string>,
  relatedCollection: RelatedCollection,
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

    const result: unknown = value(
      createRelationMutator<Contract<SqlStorage>, string>(relatedCollection(relation)),
    );
    const elements: readonly unknown[] = Array.isArray(result) ? result : [result];
    const mutations = elements.map((element, index) => {
      const at = Array.isArray(result) ? index : undefined;
      if (Array.isArray(element) || !isRelationMutationDescriptor(element)) {
        throw invalidRelationField(fieldName, modelName, Array.isArray(element), at);
      }
      return element;
    });
    if (
      mutations.length > 1 &&
      (relation.cardinality === 'N:1' || relation.cardinality === '1:1')
    ) {
      throw ormError(
        'ORM.RELATION_MUTATION_UNSUPPORTED',
        `Relation "${fieldName}" on model "${modelName}" is a to-one relation and takes one operation, not ${mutations.length}`,
        {
          meta: {
            relation: fieldName,
            model: modelName,
            reason: 'to-one-relation',
            operations: mutations.length,
          },
        },
      );
    }
    for (const mutation of mutations) {
      if (mutation.kind === 'create' && mutation.options !== undefined) {
        assertCreateOptions(contract, fieldName, relation, mutation.options);
      }
    }
    if (mutations.length > 0) {
      relationMutations.push({ name: fieldName, relation, mutations, relatedCollection });
    }
  }

  return {
    scalarData,
    relationMutations,
  };
}

function assertCreateOptions(
  contract: Contract<SqlStorage>,
  name: string,
  relation: ResolvedRelation,
  { onConflict, conflictOn }: NestedCreateOptions<Contract<SqlStorage>, string>,
): void {
  if (onConflict !== 'skip' && onConflict !== 'connect') {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `create() nested mutation for relation "${name}" takes onConflict "skip" or "connect"; received ${JSON.stringify(onConflict)}`,
      { meta: { kind: 'create', relation: name, problem: 'invalid-on-conflict' } },
    );
  }
  const fields = getModelFieldColumns(contract, relation.toNamespace, relation.to);
  const unknownFields = (conflictOn ?? []).filter((field) => !Object.hasOwn(fields, field));
  if (unknownFields.length > 0) {
    throw ormError(
      'ORM.RELATION_MUTATION_INVALID',
      `conflictOn of create() nested mutation for relation "${name}" names fields model "${relation.to}" does not have: ${unknownFields.map((field) => `"${field}"`).join(', ')}`,
      {
        meta: {
          kind: 'create',
          relation: name,
          problem: 'unknown-conflict-field',
          fields: unknownFields,
        },
      },
    );
  }
  if (isVariantInOwnTable(contract, relation)) {
    throw ormError(
      'ORM.RELATION_MUTATION_UNSUPPORTED',
      `create() nested mutation for relation "${name}" does not support onConflict: its target, variant "${relation.to}", is stored in its own table`,
      {
        meta: { kind: 'create', relation: name, reason: 'mti-variant', variant: relation.to },
      },
    );
  }
  if (onConflict === 'skip') {
    const reason = hasThrough(relation)
      ? 'many-to-many-relation'
      : relation.cardinality === 'N:1' || relation.cardinality === '1:1'
        ? 'to-one-relation'
        : undefined;
    if (reason !== undefined) {
      throw ormError(
        'ORM.RELATION_MUTATION_UNSUPPORTED',
        `create() nested mutation for relation "${name}" supports onConflict "skip" only on one-to-many relations`,
        { meta: { kind: 'create', relation: name, reason } },
      );
    }
    return;
  }
  throw ormError(
    'ORM.RELATION_MUTATION_UNSUPPORTED',
    `create() nested mutation for relation "${name}" does not support onConflict "connect"`,
    { meta: { kind: 'create', relation: name, reason: 'on-conflict-connect' } },
  );
}

function isVariantInOwnTable(contract: Contract<SqlStorage>, relation: ResolvedRelation): boolean {
  const base = modelOf(contract, relation.toNamespace, relation.to)?.base;
  if (base === undefined) {
    return false;
  }
  const variants = resolvePolymorphismInfo(contract, base.namespace, base.model)?.variants;
  return [...(variants?.values() ?? [])].some(
    (variant) =>
      variant.modelName === relation.to &&
      variant.namespaceId === relation.toNamespace &&
      variant.strategy === 'mti',
  );
}

function invalidRelationField(
  fieldName: string,
  modelName: string,
  nested: boolean,
  index: number | undefined,
) {
  const at = index === undefined ? '' : ` at index ${index}`;
  return ormError(
    'ORM.RELATION_MUTATION_INVALID',
    `Relation field "${fieldName}" on model "${modelName}" ${nested ? `returned a nested array${at}; return one flat array of mutations` : `returned an invalid mutation descriptor${at}`}`,
    {
      meta: {
        relation: fieldName,
        model: modelName,
        problem: nested ? 'nested-array' : 'invalid-descriptor',
        ...ifDefined('index', index),
      },
    },
  );
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
  mutations,
}: JunctionRelationMutation): void {
  const { through } = relation;
  const mutation = mutations.find(({ kind }) => kind === 'create' || kind === 'connect');
  if (mutation === undefined || through.requiredPayloadColumns.length === 0) {
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
