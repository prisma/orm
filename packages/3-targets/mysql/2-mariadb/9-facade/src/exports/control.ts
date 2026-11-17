import mariadbAdapter from '@internal/adapter-mariadb/control';
import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import mariadb from '@internal/target-mariadb/control';
import { ifDefined } from '@internal/utils/defined';

export interface MariadbControlClientOptions {
  readonly connection?: string;
  readonly extensions?: ControlClientOptions['extensions'];
}

/** A control client for a MariaDB database: migrations, verify, sign and introspection. */
export function createMariadbControlClient(
  options: MariadbControlClientOptions = {},
): ControlClient {
  return createControlClient({
    family: sql,
    target: mariadb,
    adapter: mariadbAdapter,
    driver: mariadbDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  });
}

export type { ControlClient };
