/**
 * Control-API facade for Postgres.
 *
 * Collapses the five-package wiring required to drive control-side
 * operations (`dbInit`, `dbUpdate`, `dbVerify`, `migrate`, …) into
 * a single `createPostgresControlClient()` call. Mirrors what
 * `@internal/postgres/runtime` did for the query side.
 */

import postgresAdapter from '@internal/adapter-postgres/control';
import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { ifDefined } from '@internal/utils/defined';

export interface PostgresControlClientOptions {
  /**
   * Default Postgres connection string. When set, operations like `dbInit`
   * auto-connect without an explicit `connect()` call. Equivalent to the
   * `connection` field on the underlying `ControlClientOptions`.
   */
  readonly connection?: string;
  /**
   * Composed extension descriptors. Pass the same descriptors here that
   * the contract was authored against.
   */
  readonly extensions?: ControlClientOptions['extensions'];
}

export function createPostgresControlClient(
  options: PostgresControlClientOptions = {},
): ControlClient {
  const clientOptions: ControlClientOptions = {
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
