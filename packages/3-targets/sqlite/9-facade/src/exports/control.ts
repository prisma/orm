import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { ifDefined } from '@internal/utils/defined';
import { sqliteControlAdapter, sqliteTarget } from '../config/components';

export interface SqliteControlClientOptions {
  readonly connection?: string;
  readonly extensions?: ControlClientOptions['extensions'];
}

export function createSqliteControlClient(options: SqliteControlClientOptions = {}): ControlClient {
  const clientOptions: ControlClientOptions = {
    family: sql,
    target: sqliteTarget,
    adapter: sqliteControlAdapter,
    driver: sqliteDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
