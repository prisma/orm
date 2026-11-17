import mongoAdapter from '@internal/adapter-mongo/control';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { moduleBase } from './module-base';

export const contractTypesModule = `${moduleBase}/contract-types`;

export const mongoTarget: typeof mongoTargetDescriptor = restateTypeDeclarations(
  mongoTargetDescriptor,
  contractTypesModule,
);
export const mongoControlAdapter: typeof mongoAdapter = restateTypeDeclarations(
  mongoAdapter,
  contractTypesModule,
);

export const controlComponents: {
  readonly family: typeof mongoFamilyDescriptor;
  readonly target: typeof mongoTarget;
  readonly adapter: typeof mongoControlAdapter;
  readonly driver: typeof mongoDriver;
} = {
  family: mongoFamilyDescriptor,
  target: mongoTarget,
  adapter: mongoControlAdapter,
  driver: mongoDriver,
};
