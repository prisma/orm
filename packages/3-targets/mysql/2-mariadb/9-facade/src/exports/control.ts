import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import { ifDefined } from '@internal/utils/defined';
import { mariadbControlAdapter, mariadbTarget } from '../config/components';

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
    target: mariadbTarget,
    adapter: mariadbControlAdapter,
    driver: mariadbDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  });
}

export type { ControlClient };
