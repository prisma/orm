import mongoAdapter from '@internal/adapter-mongo/control';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors this package hands on: their type declarations name its own generated-types module. */
export const mongoTarget: typeof mongoTargetDescriptor = restateTypeDeclarations(
  mongoTargetDescriptor,
  generatedTypesModule,
);
export const mongoControlAdapter: typeof mongoAdapter = restateTypeDeclarations(
  mongoAdapter,
  generatedTypesModule,
);

/** The control components every entrypoint of this package builds a control stack from: `defineConfig` and the control client are given the same ones. */
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
