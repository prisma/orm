import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import { ifDefined } from '@internal/utils/defined';
import { controlComponents } from '../config/components';

export interface MongoControlClientOptions {
  readonly connection?: string;
  readonly extensions?: ControlClientOptions['extensions'];
}

export function createMongoControlClient(options: MongoControlClientOptions = {}): ControlClient {
  const clientOptions: ControlClientOptions = {
    ...controlComponents,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
