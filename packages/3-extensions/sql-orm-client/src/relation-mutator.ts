import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type {
  MutationCreateInput,
  RelationMutation,
  RelationMutationConnect,
  RelationMutationCreate,
  RelationMutationDisconnect,
  RelationMutationResult,
  RelationMutator,
} from './types';

export function createRelationMutator<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
>(): RelationMutator<TContract, ModelName> {
  return {
    create(
      data:
        | MutationCreateInput<TContract, ModelName>
        | readonly MutationCreateInput<TContract, ModelName>[],
    ) {
      const rows = Array.isArray(data) ? [...data] : [data];
      return {
        kind: 'create',
        data: rows,
      } as RelationMutationCreate<TContract, ModelName>;
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
  if (
    candidate.kind !== 'create' &&
    candidate.kind !== 'connect' &&
    candidate.kind !== 'disconnect'
  ) {
    return false;
  }

  return true;
}

export function isRelationMutationCallback(
  value: unknown,
): value is (
  mutator: RelationMutator<Contract<SqlStorage>, string>,
) => RelationMutationResult<Contract<SqlStorage>, string> {
  return typeof value === 'function';
}
