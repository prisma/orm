import type { Contract } from '@internal/contract/types';
import type { AsyncIterableResult, MetaBuilder } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { Preparable } from '@internal/sql-relational-core/plan';
import type { WhereInput } from './collection-internal-types';
import type { HasNoUniqueFilter, HasTypeState } from './collection-types';
import type {
  AggregateBuilder,
  AggregateResult,
  AggregateSpec,
  CollectionTypeState,
} from './types';

export interface PreparedCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Row,
  State extends CollectionTypeState,
> extends HasTypeState<State> {
  aggregate<Spec extends AggregateSpec, Self = unknown>(
    this: Self & HasNoUniqueFilter,
    selector: (aggregate: AggregateBuilder<TContract, ModelName, State['nsId']>) => Spec,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Preparable<Record<string, unknown>, Promise<AggregateResult<Spec>>>;
  all<Self>(
    this: Self & HasNoUniqueFilter,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Preparable<Record<string, unknown>, AsyncIterableResult<Row>>;
  first(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Preparable<Record<string, unknown>, Promise<Row | null>>;
  firstOrThrow(
    filter?: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): Preparable<Record<string, unknown>, Promise<Row>>;
}
