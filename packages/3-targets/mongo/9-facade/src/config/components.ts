import mongoAdapter from '@internal/adapter-mongo/control';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors every entrypoint of this package hands on: their type declarations name its own generated-types module. */
export const mongoTarget: typeof mongoTargetDescriptor = restateTypeDeclarations(
  mongoTargetDescriptor,
  generatedTypesModule,
);
export const mongoControlAdapter: typeof mongoAdapter = restateTypeDeclarations(
  mongoAdapter,
  generatedTypesModule,
);
