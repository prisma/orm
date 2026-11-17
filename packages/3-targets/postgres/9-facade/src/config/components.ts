import postgresAdapter from '@internal/adapter-postgres/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import postgres from '@internal/target-postgres/control';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors every entrypoint of this package hands on: their type declarations name its own generated-types module. */
export const postgresTarget: typeof postgres = restateTypeDeclarations(
  postgres,
  generatedTypesModule,
);
export const postgresControlAdapter = restateTypeDeclarations(
  postgresAdapter,
  generatedTypesModule,
);
