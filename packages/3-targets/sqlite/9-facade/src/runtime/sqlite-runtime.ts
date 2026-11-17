import type { Contract } from '@internal/contract/types';
import type { SqlStorage } from '@internal/sql-contract/types';
import { type Runtime, SqlRuntimeBase } from '@internal/sql-runtime';

/**
 * The SQLite runtime interface. App code depends on this — `sqlite()` returns it
 * and `Runtime` (the common interface) is the everyday parameter type.
 *
 * `SqliteRuntimeImpl` is the implementing class. It is exported so that other
 * extensions can subclass it; app code never references it directly.
 */
export interface SqliteRuntime extends Runtime {}

export class SqliteRuntimeImpl<
  TContract extends Contract<SqlStorage> = Contract<SqlStorage>,
> extends SqlRuntimeBase<TContract> {}
