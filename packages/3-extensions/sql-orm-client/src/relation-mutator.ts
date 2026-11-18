import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import type {
  CollectionState,
  ConflictRowCreateInput,
  FilteredRelationMutator,
  MutationCreateInput,
  NestedCreateOptions,
  RelationMutation,
  RelationMutationConnect,
  RelationMutationCreate,
  RelationMutationDisconnect,
  RelationMutationFilter,
  RelationMutationUpdateAllData,
  RelationMutator,
} from './types';

export interface RelationCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
> {
  readonly state: CollectionState;
  where(
    filter: RelationMutationFilter<TContract, ModelName>,
  ): RelationCollection<TContract, ModelName>;
  variant(value: string): RelationCollection<TContract, ModelName>;
}

function createFilteredRelationMutator<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
>(
  related: RelationCollection<TContract, ModelName>,
): FilteredRelationMutator<TContract, ModelName> {
  return {
    where(input: RelationMutationFilter<TContract, ModelName>) {
      return createFilteredRelationMutator<TContract, ModelName>(related.where(input));
    },
    updateAll(data: RelationMutationUpdateAllData<TContract, ModelName>) {
      return { kind: 'updateAll', state: related.state, data: { ...data } };
    },
    deleteAll() {
      return { kind: 'deleteAll', state: related.state };
    },
    update(data: RelationMutationUpdateAllData<TContract, ModelName>) {
      return { kind: 'update', state: related.state, data: { ...data } };
    },
    delete() {
      return { kind: 'delete', state: related.state };
    },
  };
}

export function createRelationMutator<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
>(related: RelationCollection<TContract, ModelName>): RelationMutator<TContract, ModelName> {
  const mutator = {
    ...createFilteredRelationMutator<TContract, ModelName>(related),
    create(
      data:
        | MutationCreateInput<TContract, ModelName>
        | ConflictRowCreateInput<TContract, ModelName>
        | readonly (
            | MutationCreateInput<TContract, ModelName>
            | ConflictRowCreateInput<TContract, ModelName>
          )[],
      options?: NestedCreateOptions<TContract, ModelName>,
    ) {
      const rows = Array.isArray(data) ? [...data] : [data];
      return {
        kind: 'create',
        data: rows,
        ...ifDefined('options', options),
      } as RelationMutationCreate<TContract, ModelName>;
    },
    variant(value: string) {
      const variantCollection = related.variant(value);
      const { state } = variantCollection;
      const { variantValue } = state;
      return {
        ...createFilteredRelationMutator<TContract, ModelName>(variantCollection),
        create: (
          data:
            | MutationCreateInput<TContract, ModelName>
            | ConflictRowCreateInput<TContract, ModelName>
            | readonly (
                | MutationCreateInput<TContract, ModelName>
                | ConflictRowCreateInput<TContract, ModelName>
              )[],
          options?: NestedCreateOptions<TContract, ModelName>,
        ): RelationMutationCreate<TContract, ModelName> => ({
          ...mutator.create(data, options),
          ...ifDefined('variant', variantValue),
        }),
        connect: (
          criteria: Record<string, unknown> | readonly Record<string, unknown>[],
        ): RelationMutationConnect<TContract, ModelName> => ({
          ...mutator.connect(criteria),
          state,
        }),
        disconnect: (
          criteria?: readonly Record<string, unknown>[],
        ): RelationMutationDisconnect<TContract, ModelName> => ({
          ...mutator.disconnect(criteria),
          state,
        }),
      };
    },
    connect(criteria: Record<string, unknown> | readonly Record<string, unknown>[]) {
      const values = Array.isArray(criteria) ? [...criteria] : [criteria];
      return {
        kind: 'connect',
        criteria: values,
      } as RelationMutationConnect<TContract, ModelName>;
    },
    disconnect(criteria?: readonly Record<string, unknown>[]) {
      if (!criteria) {
        return {
          kind: 'disconnect',
        } as RelationMutationDisconnect<TContract, ModelName>;
      }

      return {
        kind: 'disconnect',
        criteria: [...criteria],
      } as RelationMutationDisconnect<TContract, ModelName>;
    },
  };
  return mutator as RelationMutator<TContract, ModelName>;
}

export function isRelationMutationDescriptor(
  value: unknown,
): value is RelationMutation<Contract<SqlStorage>, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { kind?: unknown; state?: unknown; data?: unknown };
  if (candidate.kind === 'update') {
    return hasFilters(candidate.state) && isObject(candidate.data);
  }
  if (candidate.kind === 'delete') {
    return hasFilters(candidate.state);
  }
  return (
    candidate.kind === 'create' ||
    candidate.kind === 'connect' ||
    candidate.kind === 'disconnect' ||
    candidate.kind === 'updateAll' ||
    candidate.kind === 'deleteAll'
  );
}

function isObject(value: unknown): value is object {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function hasFilters(state: unknown): boolean {
  return isObject(state) && 'filters' in state && Array.isArray(state.filters);
}

export function isRelationMutationCallback(
  value: unknown,
): value is (
  mutator: RelationMutator<Contract<SqlStorage>, string>,
) => RelationMutation<Contract<SqlStorage>, string> {
  return typeof value === 'function';
}
