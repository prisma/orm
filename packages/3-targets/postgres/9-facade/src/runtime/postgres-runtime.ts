import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { type Runtime, SqlRuntimeBase } from '@internal/sql-runtime';
import postgresTarget from '@internal/target-postgres/runtime';

/**
 * The Postgres runtime interface. App code depends on this — `postgres()` returns it
 * and `Runtime` (the common interface) is the everyday parameter type.
 *
 * `PostgresRuntimeImpl` is the implementing class. It is exported so that other
 * extensions (e.g. Supabase) can subclass it; app code never references it directly.
 */
export interface PostgresRuntime extends Runtime {}

type PostgresListDecoder = (
  wireValue: unknown,
  decodeElement: (value: unknown) => Promise<unknown>,
) => Promise<readonly unknown[]>;

export class PostgresRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntimeBase<TContract> {
  protected override getListDecoder(): PostgresListDecoder {
    return postgresTarget.listDecoder();
  }
}
