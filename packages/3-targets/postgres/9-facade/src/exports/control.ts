/**
 * Control-API facade for Postgres.
 *
 * Collapses the five-package wiring required to drive control-side
 * operations (`dbInit`, `dbUpdate`, `dbVerify`, `migrate`, …) into
 * a single `createPostgresControlClient()` call. Mirrors what
 * `@internal/postgres/runtime` did for the query side.
 */

import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import {
  type PostgresServerVersion,
  postgresServerVersions,
} from '@internal/target-postgres/server-version';
import { ifDefined } from '@internal/utils/defined';
import { controlComponents } from '../config/components';
import { capabilitiesForVersion } from '../contract/database-version';

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
  /**
   * The PostgreSQL version a Prisma schema contract the client emits is written for, as the config's contract entry states it. A TypeScript contract states its own.
   */
  readonly version?: PostgresServerVersion;
}

export function createPostgresControlClient(
  options: PostgresControlClientOptions = {},
): ControlClient {
  const clientOptions: ControlClientOptions = {
    ...controlComponents,
    ...ifDefined(
      'target',
      options.version === undefined
        ? undefined
        : {
            ...controlComponents.target,
            capabilities: capabilitiesForVersion(postgresServerVersions, options.version),
          },
    ),
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
