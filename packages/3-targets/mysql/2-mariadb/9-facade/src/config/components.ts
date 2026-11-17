import mariadbAdapter from '@internal/adapter-mariadb/control';
import mariadb from '@internal/target-mariadb/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors every entrypoint of this package hands on: their type declarations name its own generated-types module. */
export const mariadbTarget: typeof mariadb = restateTypeDeclarations(mariadb, generatedTypesModule);
export const mariadbControlAdapter: typeof mariadbAdapter = restateTypeDeclarations(
  mariadbAdapter,
  generatedTypesModule,
);
