import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import sqlite from '@internal/target-sqlite/control';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors this package hands on: their type declarations name its own generated-types module. */
export const sqliteTarget: typeof sqlite = restateTypeDeclarations(sqlite, generatedTypesModule);
export const sqliteControlAdapter: typeof sqliteAdapter = restateTypeDeclarations(
  sqliteAdapter,
  generatedTypesModule,
);

/** The control components every entrypoint of this package builds a control stack from: `defineConfig` and the control client are given the same ones. */
export const controlComponents: {
  readonly family: typeof sql;
  readonly target: typeof sqliteTarget;
  readonly adapter: typeof sqliteControlAdapter;
  readonly driver: typeof sqliteDriver;
} = {
  family: sql,
  target: sqliteTarget,
  adapter: sqliteControlAdapter,
  driver: sqliteDriver,
};
