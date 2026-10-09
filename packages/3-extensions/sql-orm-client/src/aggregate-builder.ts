import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { SqlAggregateDescriptorRegistry } from '@internal/sql-relational-core/query-lane-context';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { aggregateOperationNames } from './aggregate-operations';
import { columnOfCallerField, getModelFieldColumns } from './collection-contract';
import type { AggregateBuilder, AggregateSelector } from './types';

/**
 * The aggregate selector methods, one per operation the registry contributes —
 * the runtime mirror of the contract's emitted aggregate map, which is what
 * types the surface as {@link AggregateBuilder}. Each method builds a selector
 * carrying the operation's name and, for a field-taking call, the field's
 * storage column; what a selector resolves to is the plan compiler's question
 * to the same registry.
 */
export function createAggregateBuilder<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  NsId extends string = never,
>(
  contract: TContract,
  aggregates: SqlAggregateDescriptorRegistry,
  namespaceId: string,
  modelName: ModelName,
): AggregateBuilder<TContract, ModelName, NsId> {
  const fieldColumns = getModelFieldColumns(contract, namespaceId, modelName);
  const builder: Record<string, (field?: string) => AggregateSelector<unknown>> = {};
  for (const operation of aggregateOperationNames(aggregates)) {
    builder[operation] = (field?: string) => {
      const column =
        field === undefined
          ? undefined
          : columnOfCallerField(contract, namespaceId, fieldColumns, modelName, field);
      return { kind: 'aggregate', fn: operation, ...ifDefined('column', column) };
    };
  }
  return blindCast<
    AggregateBuilder<TContract, ModelName, NsId>,
    "the registry's operations are the contract's emitted aggregate map, whose mapped type enforces each method's arity and result"
  >(builder);
}

export function isAggregateSelector(value: unknown): value is AggregateSelector<unknown> {
  if (!value || typeof value !== 'object') {
    return false;
  }

  const candidate = value as { kind?: unknown; fn?: unknown };
  return candidate.kind === 'aggregate' && typeof candidate.fn === 'string';
}
