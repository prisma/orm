import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { castAs } from '@internal/utils/casts';
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

function connectOf<TContract extends Contract<SqlStorage>, ModelName extends string>(
  criteria: Record<string, unknown> | readonly Record<string, unknown>[],
  state: CollectionState | undefined,
): RelationMutationConnect<TContract, ModelName> {
  return {
    kind: 'connect',
    criteria: castAs<RelationMutationConnect<TContract, ModelName>['criteria']>(
      isList(criteria) ? [...criteria] : [criteria],
    ),
    ...ifDefined('state', state),
  };
}

function disconnectOf<TContract extends Contract<SqlStorage>, ModelName extends string>(
  criteria: readonly Record<string, unknown>[] | undefined,
  state: CollectionState | undefined,
): RelationMutationDisconnect<TContract, ModelName> {
  return {
    kind: 'disconnect',
    ...ifDefined(
      'criteria',
      criteria === undefined
        ? undefined
        : castAs<NonNullable<RelationMutationDisconnect<TContract, ModelName>['criteria']>>([
            ...criteria,
          ]),
    ),
    ...ifDefined('state', state),
  };
}

function createVariantRelationMutator<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
>(variantCollection: RelationCollection<TContract, ModelName>) {
  const { state } = variantCollection;
  return {
    ...createFilteredRelationMutator<TContract, ModelName>(variantCollection),
    create(
      data:
        | MutationCreateInput<TContract, ModelName>
        | readonly MutationCreateInput<TContract, ModelName>[],
    ): RelationMutationCreate<TContract, ModelName> {
      return {
        kind: 'create',
        data: createRows(data),
        ...ifDefined('variant', state.variantValue),
      };
    },
    connect(criteria: Record<string, unknown> | readonly Record<string, unknown>[]) {
      return connectOf<TContract, ModelName>(criteria, state);
    },
    disconnect(criteria?: readonly Record<string, unknown>[]) {
      return disconnectOf<TContract, ModelName>(criteria, state);
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
      return createVariantRelationMutator<TContract, ModelName>(related.variant(value));
    },
    connect(criteria: Record<string, unknown> | readonly Record<string, unknown>[]) {
      return connectOf<TContract, ModelName>(criteria, undefined);
    },
    disconnect(criteria?: readonly Record<string, unknown>[]) {
      return disconnectOf<TContract, ModelName>(criteria, undefined);
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
