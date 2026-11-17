import sql from '@prisma/orm-family-sql/family/control';
import { restateTypeDeclarations } from '@prisma/orm-framework/target-package-config/type-declarations';
import postgresAdapter from '@prisma/orm-target-postgres/adapter/control';
import postgresDriver from '@prisma/orm-target-postgres/driver/control';
import postgres from '@prisma/orm-target-postgres/target/control';

export const typesModule = 'prisma-orm-standin/contract-types';

export const migrationModule = 'prisma-orm-standin/migration';

export const family: typeof sql = sql;
export const target: typeof postgres = restateTypeDeclarations(postgres, typesModule);
export const adapter: typeof postgresAdapter = restateTypeDeclarations(
  postgresAdapter,
  typesModule,
);
export const driver: typeof postgresDriver = postgresDriver;
