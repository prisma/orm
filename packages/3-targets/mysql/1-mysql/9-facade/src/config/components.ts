import mysqlAdapter from '@internal/adapter-mysql/control';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import mysql from '@internal/target-mysql/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import { moduleBase } from './module-base';

export const contractTypesModule = `${moduleBase}/contract-types`;

export const migrationModule = `${moduleBase}/migration`;

export const mysqlTarget: typeof mysql = restateTypeDeclarations(mysql, contractTypesModule);
export const mysqlControlAdapter: typeof mysqlAdapter = restateTypeDeclarations(
  mysqlAdapter,
  contractTypesModule,
);

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
