import mysqlAdapter from '@internal/adapter-mysql/control';
import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import mysql from '@internal/target-mysql/control';
import { ifDefined } from '@internal/utils/defined';

export interface MysqlControlClientOptions {
  readonly connection?: string;
  readonly extensions?: ControlClientOptions['extensions'];
}

/** A control client for a MySQL database: migrations, verify, sign and introspection. */
export function createMysqlControlClient(options: MysqlControlClientOptions = {}): ControlClient {
  return createControlClient({
    family: sql,
    target: mysql,
    adapter: mysqlAdapter,
    driver: mysqlDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  });
}

export type { ControlClient };
