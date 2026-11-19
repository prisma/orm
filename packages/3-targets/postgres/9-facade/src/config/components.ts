import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { restateTypeDeclarations } from '@internal/target-package-config/type-declarations';
import postgres from '@internal/target-postgres/control';
import { moduleBase } from './module-base';

export const contractTypesModule = `${moduleBase}/contract-types`;

export const contractBuilderModule = `${moduleBase}/contract-builder`;

export const postgresTarget: typeof postgres = restateTypeDeclarations(
  postgres,
  contractTypesModule,
);
export const postgresControlAdapter = restateTypeDeclarations(postgresAdapter, contractTypesModule);

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
