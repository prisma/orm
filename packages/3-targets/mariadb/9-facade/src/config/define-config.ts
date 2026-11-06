import mariadbAdapter from '@internal/adapter-mariadb/control';
import type { PrismaNextConfig } from '@internal/config/config-types';
import mariadbDriver from '@internal/driver-mariadb/control';
import { createMysqlDefineConfig, type MysqlConfigOptions } from '@internal/mysql/config';
import mariadb from '@internal/target-mariadb/control';
import mariadbPackRef from '@internal/target-mariadb/pack';
import { extname } from 'pathe';
import { pslContractRequired } from '../errors';

export type MariadbConfigOptions = MysqlConfigOptions<'mariadb'>;

const mariadbDefineConfig = createMysqlDefineConfig({
  pack: mariadbPackRef,
  target: mariadb,
  adapter: mariadbAdapter,
  driver: mariadbDriver,
});

/** The `prisma.config.ts` of a MariaDB project, whose contract is a `.prisma` schema. */
export function defineConfig(options: MariadbConfigOptions): PrismaNextConfig<'sql', 'mariadb'> {
  if (extname(options.contract) !== '.prisma') throw pslContractRequired(options.contract);
  return mariadbDefineConfig(options);
}
