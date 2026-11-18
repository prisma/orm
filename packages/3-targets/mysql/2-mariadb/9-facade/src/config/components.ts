import mariadbAdapter from '@internal/adapter-mariadb/control';
import mariadbDriver from '@internal/driver-mariadb/control';
import sql from '@internal/family-sql/control';
import mariadb from '@internal/target-mariadb/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { moduleBase } from './module-base';

export const contractTypesModule = `${moduleBase}/contract-types`;

export const migrationModule = `${moduleBase}/migration`;

export const mariadbTarget: typeof mariadb = restateTypeDeclarations(mariadb, contractTypesModule);
export const mariadbControlAdapter: typeof mariadbAdapter = restateTypeDeclarations(
  mariadbAdapter,
  contractTypesModule,
);

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
