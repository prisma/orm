import type { PrismaConfig } from '@internal/config/config-types';
import { createMysqlDefineConfig, type MysqlConfigOptions } from '@internal/mysql/config';
import mariadbPackRef from '@internal/target-mariadb/pack';
import { controlComponents, generatedTypesModule, migrationModule } from './components';

export type MariadbConfigOptions = MysqlConfigOptions<'mariadb'>;

/** The `prisma.config.ts` of a MariaDB project, whose contract is a Prisma schema: a `.prisma` file, a folder of them, or a glob. */
export const defineConfig: (options: MariadbConfigOptions) => PrismaConfig<'sql', 'mariadb'> =
  createMysqlDefineConfig({
    ...controlComponents,
    pack: mariadbPackRef,
    typesModule: generatedTypesModule,
    migrationModule,
  });
