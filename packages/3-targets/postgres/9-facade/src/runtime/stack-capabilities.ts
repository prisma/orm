import type postgresAdapter from '@internal/adapter-postgres/runtime';
import type { Contract } from '@internal/contract/types';
import type postgresDriver from '@internal/driver-postgres/runtime';
import type { SqlStorage } from '@internal/sql-contract/types';
import type { StackProvides } from '@internal/sql-runtime';
import type postgresTarget from '@internal/target-postgres/runtime';

/**
 * The check `postgres()` and `postgresServerless()` make against the target, adapter and driver they run with. A function generic over contracts that creates a client compiles for any contract, so its callers are checked only when the client is created.
 */
export type PostgresStackProvides<TContract extends Contract<SqlStorage>> = StackProvides<
  TContract,
  {
    readonly target: typeof postgresTarget;
    readonly adapter: typeof postgresAdapter;
    readonly driver: typeof postgresDriver;
  }
>;
