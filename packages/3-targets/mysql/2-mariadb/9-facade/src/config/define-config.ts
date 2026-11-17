import type { PrismaNextConfig } from '@internal/config/config-types';
import mariadbDriver from '@internal/driver-mariadb/control';
import { createMysqlDefineConfig, type MysqlConfigOptions } from '@internal/mysql/config';
import mariadbPackRef from '@internal/target-mariadb/pack';
import { mariadbControlAdapter, mariadbTarget } from './components';
import { moduleBase } from './module-base';

export type MariadbConfigOptions = MysqlConfigOptions<'mariadb'>;

/** The `prisma.config.ts` of a MariaDB project, whose contract is a Prisma schema: a `.prisma` file, a folder of them, or a glob. */
export const defineConfig: (options: MariadbConfigOptions) => PrismaNextConfig<'sql', 'mariadb'> =
  createMysqlDefineConfig({
    pack: mariadbPackRef,
    target: mariadbTarget,
    adapter: mariadbControlAdapter,
    driver: mariadbDriver,
    moduleBase,
  });
