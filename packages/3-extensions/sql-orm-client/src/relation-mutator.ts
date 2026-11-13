import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { ifDefined } from '@internal/utils/defined';
import type {
  CollectionState,
  FilteredRelationMutator,
  MutationCreateInput,
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

function isList<T>(data: T | readonly T[]): data is readonly T[] {
  return Array.isArray(data);
}

function createRows<TContract extends Contract<SqlStorage>, ModelName extends string>(
  data:
    | MutationCreateInput<TContract, ModelName>
    | readonly MutationCreateInput<TContract, ModelName>[],
): MutationCreateInput<TContract, ModelName>[] {
  return isList(data) ? [...data] : [data];
}

function createVariantRelationMutator<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
>(variant: string | undefined) {
  return {
    create(
      data:
        | MutationCreateInput<TContract, ModelName>
        | readonly MutationCreateInput<TContract, ModelName>[],
    ): RelationMutationCreate<TContract, ModelName> {
      return { kind: 'create', data: createRows(data), ...ifDefined('variant', variant) };
    },
  };
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
  };
}

export function createRelationMutator<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
>(related: RelationCollection<TContract, ModelName>): RelationMutator<TContract, ModelName> {
  return {
    ...createFilteredRelationMutator<TContract, ModelName>(related),
    create(
      data:
        | MutationCreateInput<TContract, ModelName>
        | readonly MutationCreateInput<TContract, ModelName>[],
    ): RelationMutationCreate<TContract, ModelName> {
      return { kind: 'create', data: createRows(data) };
    },
    variant(value: string) {
      return createVariantRelationMutator<TContract, ModelName>(
        related.variant(value).state.variantValue,
      );
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
  } as RelationMutator<TContract, ModelName>;
}

export function isRelationMutationDescriptor(
  value: unknown,
): value is RelationMutation<Contract<SqlStorage>, string> {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    return false;
  }

  const candidate = value as { kind?: unknown };
  return (
    candidate.kind === 'create' ||
    candidate.kind === 'connect' ||
    candidate.kind === 'disconnect' ||
    candidate.kind === 'updateAll' ||
    candidate.kind === 'deleteAll'
  );
}

export function isRelationMutationCallback(
  value: unknown,
): value is (
  mutator: RelationMutator<Contract<SqlStorage>, string>,
) => RelationMutation<Contract<SqlStorage>, string> {
  return typeof value === 'function';
}
