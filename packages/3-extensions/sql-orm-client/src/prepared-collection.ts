import type { Contract } from '@internal/contract/types';
import type { AsyncIterableResult, MetaBuilder } from '@internal/framework-components/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { RowQuery } from './collection-dispatch';
import type { WhereInput } from './collection-internal-types';
import type { CollectionTypeState } from './types';

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
    filter: WhereInput<TContract, State['nsId'], ModelName, State['variantName']>,
    configure?: (meta: MetaBuilder<'read'>) => void,
  ): RowQuery<Record<string, unknown>, Promise<Row | null>>;
}
