import mariadbAdapter from '@internal/adapter-mariadb/control';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import mariadb from '@internal/target-mariadb/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors this package hands on: their type declarations name its own generated-types module. */
export const mariadbTarget: typeof mariadb = restateTypeDeclarations(mariadb, generatedTypesModule);
export const mariadbControlAdapter: typeof mariadbAdapter = restateTypeDeclarations(
  mariadbAdapter,
  generatedTypesModule,
);

/** The control components every entrypoint of this package builds a control stack from: `defineConfig` and the control client are given the same ones. */
export const controlComponents: {
  readonly family: typeof sql;
  readonly target: typeof mariadbTarget;
  readonly adapter: typeof mariadbControlAdapter;
  readonly driver: typeof mariadbDriver;
} = {
  family: sql,
  target: mariadbTarget,
  adapter: mariadbControlAdapter,
  driver: mariadbDriver,
};
