import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { type Runtime, SqlRuntimeBase } from '@internal/sql-runtime';

/**
 * The MySQL runtime interface. App code depends on this — `mysql()` returns it
 * and `Runtime` (the common interface) is the everyday parameter type.
 *
 * `MysqlRuntimeImpl` is the implementing class. It is exported so that other
 * extensions can subclass it; app code never references it directly.
 */
export interface MysqlRuntime extends Runtime {}

export class MysqlRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntimeBase<TContract> {}
