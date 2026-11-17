import sqliteAdapter from '@internal/adapter-sqlite/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import sqlite from '@internal/target-sqlite/control';
import { moduleBase } from './module-base';

/** The module the generated contract types of an application on this package import from. */
export const generatedTypesModule = `${moduleBase}/generated-types`;

/** The target and adapter descriptors every entrypoint of this package hands on: their type declarations name its own generated-types module. */
export const sqliteTarget: typeof sqlite = restateTypeDeclarations(sqlite, generatedTypesModule);
export const sqliteControlAdapter: typeof sqliteAdapter = restateTypeDeclarations(
  sqliteAdapter,
  generatedTypesModule,
);
