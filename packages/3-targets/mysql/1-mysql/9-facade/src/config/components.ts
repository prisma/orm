import mysqlAdapter from '@internal/adapter-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import mysql from '@internal/target-mysql/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors this package hands on: their type declarations name its own generated-types module. */
export const mysqlTarget: typeof mysql = restateTypeDeclarations(mysql, generatedTypesModule);
export const mysqlControlAdapter: typeof mysqlAdapter = restateTypeDeclarations(
  mysqlAdapter,
  generatedTypesModule,
);

/** The control components every entrypoint of this package builds a control stack from: `defineConfig` and the control client are given the same ones. */
export const controlComponents: {
  readonly family: typeof sql;
  readonly target: typeof mysqlTarget;
  readonly adapter: typeof mysqlControlAdapter;
  readonly driver: typeof mysqlDriver;
} = {
  family: sql,
  target: mysqlTarget,
  adapter: mysqlControlAdapter,
  driver: mysqlDriver,
};
