import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import postgres from '@internal/target-postgres/control';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors this package hands on: their type declarations name its own generated-types module. */
export const postgresTarget: typeof postgres = restateTypeDeclarations(
  postgres,
  generatedTypesModule,
);
export const postgresControlAdapter = restateTypeDeclarations(
  postgresAdapter,
  generatedTypesModule,
);

/** The control components every entrypoint of this package builds a control stack from: `defineConfig` and the control client are given the same ones. */
export const controlComponents: {
  readonly family: typeof sql;
  readonly target: typeof postgresTarget;
  readonly adapter: typeof postgresControlAdapter;
  readonly driver: typeof postgresDriver;
} = {
  family: sql,
  target: postgresTarget,
  adapter: postgresControlAdapter,
  driver: postgresDriver,
};
