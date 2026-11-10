import mongoAdapter from '@internal/adapter-mongo/control';
import {
  type ControlClient,
  type ControlClientOptions,
  createControlClient,
} from '@internal/cli/control-api';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { ifDefined } from '@internal/utils/defined';

export interface MongoControlClientOptions {
  readonly connection?: string;
  readonly extensions?: ControlClientOptions['extensions'];
}

export function createMongoControlClient(options: MongoControlClientOptions = {}): ControlClient {
  const clientOptions: ControlClientOptions = {
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
    driver: mongoDriver,
    ...ifDefined('connection', options.connection),
    ...ifDefined('extensions', options.extensions),
  };
  return createControlClient(clientOptions);
}

export type { ControlClient };
