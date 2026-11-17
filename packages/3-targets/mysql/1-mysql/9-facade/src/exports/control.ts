import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import { ifDefined } from '@internal/utils/defined';
import { controlComponents } from '../config/components';

export interface MysqlControlClientOptions {
  readonly connection?: string;
  readonly extensions?: ControlClientOptions['extensions'];
}

/** A control client for a MySQL database: migrations, verify, sign and introspection. */
export function createMysqlControlClient(options: MysqlControlClientOptions = {}): ControlClient {
  return createControlClient({
    ...controlComponents,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  });
}

export type { ControlClient };
