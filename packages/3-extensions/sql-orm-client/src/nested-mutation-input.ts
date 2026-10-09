import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { AnyExpression } from '@internal/sql-relational-core/ast';
import type { ExecutionContext } from '@internal/sql-relational-core/query-lane-context';
import { castAs } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { resolveColumnToField } from './collection-contract';
import { mapModelDataToStorageRow } from './collection-runtime';
import { shorthandToWhereExpr } from './filters';
import { createModelAccessor } from './model-accessor';
import { ormError } from './orm-errors';
import {
  getRelationDefinitions,
  type JunctionRelationDefinition,
  type RelationDefinition,
  type RelationDefinitionBase,
  type RelationOwnership,
} from './relation-definitions';
import {
  createRelationMutator,
  isRelationMutationCallback,
  isRelationMutationDescriptor,
} from './relation-mutator';
import type {
  MutationCreateInput,
  MutationUpdateInput,
  RelationMutation,
  RelationMutationCreate,
  RelationMutationDeleteAll,
  RelationMutationUpdateAll,
} from './types';
import { resolveWhereInput } from './where-interop';

interface ParsedRelationMutation {
  readonly relation: RelationDefinition;
  readonly mutations: readonly RelationMutation<Contract<SqlStorage>, string>[];
}

interface ParsedMutationInput {
  readonly scalarData: Record<string, unknown>;
  readonly relationMutations: readonly ParsedRelationMutation[];
}

export type ResolvedOperation =
  | { readonly kind: 'create'; readonly rows: readonly ResolvedMutationInput[] }
  | { readonly kind: 'connect'; readonly criteria: readonly AnyExpression[] }
  | { readonly kind: 'disconnect'; readonly criteria: readonly AnyExpression[] }
  | {
      readonly kind: 'updateAll';
      readonly filters: readonly AnyExpression[];
      readonly setValues: Record<string, unknown>;
    }
  | { readonly kind: 'deleteAll'; readonly filters: readonly AnyExpression[] };

interface ResolvedRelationMutation {
  readonly relation: RelationDefinition;
  readonly operations: readonly ResolvedOperation[];
}

export interface ResolvedMutationInput {
  readonly scalarData: Record<string, unknown>;
  readonly relationMutations: readonly ResolvedRelationMutation[];
}

const resolutionOrder: Record<RelationOwnership, number> = { parent: 0, junction: 1, child: 2 };

export function resolveMutationInput(
  context: ExecutionContext,
  namespaceId: string,
  modelName: string,
  input:
    | MutationCreateInput<Contract<SqlStorage>, string>
    | MutationUpdateInput<Contract<SqlStorage>, string>,
  entryPoint: 'create' | 'update',
): ResolvedMutationInput {
  return resolveParsedInput(
    context,
    parseMutationInput(context.contract, namespaceId, modelName, input),
    entryPoint,
  );
}

function parseMutationInput(
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

    if (!isRelationMutationCallback(value)) {
      throw invalidRelationField(
        fieldName,
        modelName,
        'missing-callback',
        'expects a mutator callback',
      );
    }

    const mutator = createRelationMutator<Contract<SqlStorage>, string>();
    relationMutations.push({
      relation,
      mutations: toRelationMutationList(fieldName, modelName, value(mutator)),
    });
  }

  return {
    scalarData,
    relationMutations,
  };
}

function toRelationMutationList(
  fieldName: string,
  modelName: string,
  result: unknown,
): readonly RelationMutation<Contract<SqlStorage>, string>[] {
  if (!Array.isArray(result)) {
    if (!isRelationMutationDescriptor(result)) {
      throw invalidRelationField(
        fieldName,
        modelName,
        'invalid-descriptor',
        'returned an invalid mutation descriptor',
      );
    }
    return [result];
  }

  const elements: readonly unknown[] = result;
  const mutations: RelationMutation<Contract<SqlStorage>, string>[] = [];
  for (const [index, element] of elements.entries()) {
    if (Array.isArray(element)) {
      throw invalidRelationField(
        fieldName,
        modelName,
        'nested-array',
        `returned a nested array at index ${index}; return one flat array of mutations`,
        index,
      );
    }
    if (!isRelationMutationDescriptor(element)) {
      throw invalidRelationField(
        fieldName,
        modelName,
        'invalid-descriptor',
        `returned an invalid mutation descriptor at index ${index}`,
        index,
      );
    }
    mutations.push(element);
  }
  return mutations;
}

function resolveParsedInput(
  context: ExecutionContext,
  parsed: ParsedMutationInput,
  entryPoint: 'create' | 'update',
): ResolvedMutationInput {
  return {
    scalarData: parsed.scalarData,
    relationMutations: [...parsed.relationMutations]
      .sort((a, b) => resolutionOrder[a.relation.ownership] - resolutionOrder[b.relation.ownership])
      .map(({ relation, mutations }) => ({
        relation,
        operations: mutations.map((mutation) => {
          if (entryPoint === 'create') {
            assertAllowedInCreate(relation, mutation);
          }
          return resolveOperation(context, relation, mutation);
        }),
      })),
  };
}

type FilteredWriteMutation =
  | RelationMutationUpdateAll<Contract<SqlStorage>, string>
  | RelationMutationDeleteAll<Contract<SqlStorage>, string>;

function isFilteredWrite(
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): mutation is FilteredWriteMutation {
  return mutation.kind === 'updateAll' || mutation.kind === 'deleteAll';
}

function assertAllowedInCreate(
  relation: RelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): void {
  if (mutation.kind === 'disconnect' || isFilteredWrite(mutation)) {
    throw unsupportedMutation(
      mutation.kind,
      relation,
      `${mutation.kind}() is only supported in update() nested mutations`,
    );
  }
}

function resolveOperation(
  context: ExecutionContext,
  relation: RelationDefinition,
  mutation: RelationMutation<Contract<SqlStorage>, string>,
): ResolvedOperation {
  const contract = context.contract;
  const namespaceId = relation.relatedNamespaceId;
  const modelName = relation.relatedModelName;
  const junction = relation.ownership === 'junction';
  const parentOwned = relation.ownership === 'parent';
  if (relation.ownership === 'junction') {
    assertJunctionPayloadWritable(relation, mutation.kind);
  }

  if (isFilteredWrite(mutation)) {
    if (parentOwned || (relation.ownership === 'child' && relation.cardinality === '1:1')) {
      throw unsupportedMutation(
        mutation.kind,
        relation,
        `${mutation.kind}() nested mutation for relation "${relation.relationName}" is only supported on to-many relations`,
        { reason: 'to-one-relation' },
      );
    }
    const filters = mutation.filters.flatMap((input) => {
      const filter = resolveWhereInput(input, {
        contract,
        namespaceId,
        accessor: () => createModelAccessor(context, namespaceId, modelName),
        shorthand: (shorthand) => shorthandToWhereExpr(context, namespaceId, modelName, shorthand),
      });
      return filter ? [filter] : [];
    });
    if (mutation.kind === 'deleteAll') {
      return { kind: 'deleteAll', filters };
    }
    const setValues = mapModelDataToStorageRow(contract, namespaceId, modelName, mutation.data);
    assertNoParentLinkColumn(
      contract,
      relation,
      setValues,
      junction ? new Set() : childLinkColumns(relation),
    );
    return { kind: 'updateAll', filters, setValues };
  }

  if (mutation.kind === 'create') {
    assertCreateRowsAreObjects(relation, mutation);
    const inputs = parentOwned ? mutation.data.slice(0, 1) : mutation.data;
    if (parentOwned && inputs.length === 0) {
      throw invalidMutation('create', relation, 'missing-data', 'requires data');
    }
    return {
      kind: 'create',
      rows: inputs
        .map((input) => parseMutationInput(contract, namespaceId, modelName, input))
        .map((parsed) => resolveParsedInput(context, parsed, 'create')),
    };
  }

  if (parentOwned && mutation.kind === 'disconnect') {
    return { kind: 'disconnect', criteria: [] };
  }
  const criteria = mutation.criteria ?? [];
  if (
    parentOwned ? !criteria[0] : junction && mutation.kind === 'disconnect' && criteria.length === 0
  ) {
    throw invalidMutation(mutation.kind, relation, 'missing-criterion', 'requires criterion');
  }
  return {
    kind: mutation.kind,
    criteria: (parentOwned ? criteria.slice(0, 1) : criteria).map((criterion) =>
      resolveCriterion(context, relation, mutation.kind, criterion),
    ),
  };
}

function assertCreateRowsAreObjects(
  relation: RelationDefinition,
  mutation: RelationMutationCreate<Contract<SqlStorage>, string>,
): void {
  const rows: readonly unknown[] = mutation.data;
  rows.forEach((row, index) => {
    if (row === null || row === undefined) {
      throw invalidMutation('create', relation, 'missing-data', 'requires data');
    }
    if (typeof row !== 'object' || Array.isArray(row)) {
      throw invalidMutation(
        'create',
        relation,
        'invalid-data',
        `requires an object for each row; the value at index ${index} is not an object`,
        { index },
      );
    }
  });
}

function resolveCriterion(
  context: ExecutionContext,
  relation: RelationDefinitionBase,
  kind: 'connect' | 'disconnect',
  criterion: Record<string, unknown>,
): AnyExpression {
  const criterionWhere = shorthandToWhereExpr(
    context,
    relation.relatedNamespaceId,
    relation.relatedModelName,
    castAs<MutationUpdateInput<Contract<SqlStorage>, string>>(criterion),
  );
  if (!criterionWhere) {
    throw invalidMutation(kind, relation, 'empty-criterion', 'requires non-empty criterion');
  }
  return criterionWhere;
}

function assertNoParentLinkColumn(
  contract: Contract<SqlStorage>,
  relation: RelationDefinition,
  setValues: Record<string, unknown>,
  parentLinkColumns: ReadonlySet<string>,
): void {
  const parentLinkFields = Object.keys(setValues)
    .filter((column) => parentLinkColumns.has(column))
    .map((column) =>
      resolveColumnToField(
        contract,
        relation.relatedNamespaceId,
        relation.relatedModelName,
        column,
      ),
    );
  if (parentLinkFields.length > 0) {
    throw invalidMutation(
      'updateAll',
      relation,
      'parent-link-column',
      `cannot set ${parentLinkFields.map((field) => `"${field}"`).join(', ')}, which links the related rows to their parent`,
      { fields: parentLinkFields },
    );
  }
}

function childLinkColumns(relation: RelationDefinition): ReadonlySet<string> {
  const columns = new Set<string>();
  relation.targetColumns.forEach((targetColumn, index) => {
    if (targetColumn && relation.localColumns[index]) {
      columns.add(targetColumn);
    }
  });
  return columns;
}

function assertJunctionPayloadWritable(
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
  throw unsupportedMutation(
    mutationKind,
    relation,
    `Cannot \`${mutationKind}\` on relation \`${relation.relationName}\`: its junction \`${through.table}\` has required column(s) ${cols} the relation API can't populate. Write the \`${through.table}\` junction directly or use the SQL builder.`,
    { reason: 'junction-required-columns', junction: through.table },
  );
}

function invalidRelationField(
  fieldName: string,
  modelName: string,
  problem: string,
  detail: string,
  index?: number,
) {
  return ormError(
    'ORM.RELATION_MUTATION_INVALID',
    `Relation field "${fieldName}" on model "${modelName}" ${detail}`,
    { meta: { relation: fieldName, model: modelName, problem, ...ifDefined('index', index) } },
  );
}

function invalidMutation(
  kind: string,
  relation: RelationDefinitionBase,
  problem: string,
  detail: string,
  extraMeta: Record<string, unknown> = {},
) {
  return ormError(
    'ORM.RELATION_MUTATION_INVALID',
    `${kind}() nested mutation for relation "${relation.relationName}" ${detail}`,
    { meta: { kind, relation: relation.relationName, problem, ...extraMeta } },
  );
}

function unsupportedMutation(
  kind: string,
  relation: RelationDefinitionBase,
  message: string,
  extraMeta: Record<string, unknown> = {},
) {
  return ormError('ORM.RELATION_MUTATION_UNSUPPORTED', message, {
    meta: { kind, relation: relation.relationName, ...extraMeta },
  });
}
