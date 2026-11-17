import sqliteAdapter from '@internal/adapter-sqlite/control';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import sqlite from '@internal/target-sqlite/control';
import { moduleBase } from './module-base';

export const generatedTypesModule = `${moduleBase}/generated-types`;

export const sqliteTarget: typeof sqlite = restateTypeDeclarations(sqlite, generatedTypesModule);
export const sqliteControlAdapter: typeof sqliteAdapter = restateTypeDeclarations(
  sqliteAdapter,
  generatedTypesModule,
);

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
