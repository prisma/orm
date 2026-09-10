import type { Contract } from '@internal/contract/types';
import type { AsyncIterableResult, MetaBuilder } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { WhereArg } from '@internal/sql-relational-core/ast';
import type { RowQuery } from './collection-dispatch';
import type { CollectionTypeState, ShorthandWhereFilter, VariantAwareModelAccessor } from './types';

export type FirstFilter<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  State extends CollectionTypeState,
> =
  | ((
      model: VariantAwareModelAccessor<TContract, ModelName, State['variantName'], State['nsId']>,
    ) => WhereArg)
  | ShorthandWhereFilter<TContract, State['nsId'], ModelName>;

export interface PreparedCollection<
  TContract extends Contract<SqlStorage>,
  ModelName extends string,
  Row,
  State extends CollectionTypeState,
> {
  all(
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): RowQuery<Record<string, unknown>, AsyncIterableResult<Row>>;
  first(): RowQuery<Record<string, unknown>, Promise<Row | null>>;
  first(
    filter: undefined,
    configure: (meta: MetaBuilder<'read'>) => void,
  ): RowQuery<Record<string, unknown>, Promise<Row | null>>;
  first(
    filter: FirstFilter<TContract, ModelName, State>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): RowQuery<Record<string, unknown>, Promise<Row | null>>;
}
