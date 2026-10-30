import mysqlAdapter from '@internal/adapter-mysql/control';
import type { PrismaNextConfig } from '@internal/config/config-types';
import {
  defineConfig as coreDefineConfig,
  defaultContractOutputPath,
} from '@internal/config/config-types';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/sql-contract-ts/config-types';
import { MYSQL_ENUM_CODEC_ID, MYSQL_INT_CODEC_ID } from '@internal/target-mysql/codec-ids';
import mysql from '@internal/target-mysql/control';
import mysqlPackRef from '@internal/target-mysql/pack';
import { mysqlCreateNamespace } from '@internal/target-mysql/types';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';

export interface MysqlConfigOptions {
  readonly contract: string;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'mysql'>[];
  readonly migrations?: {
    readonly dir?: string;
  };
}

/**
 * The `prisma.config.ts` of a MySQL project. A `.prisma` contract types an `enum` block of text members as a native MySQL enum, and one of integer members as `int`.
 */
export function defineConfig(options: MysqlConfigOptions): PrismaNextConfig<'sql', 'mysql'> {
  const output =
    options.output !== undefined
      ? join(options.output, 'contract.json')
      : defaultContractOutputPath(options.contract);
  const contract =
    extname(options.contract) === '.ts'
      ? typescriptContractFromPath(options.contract, output)
      : prismaContract(options.contract, {
          output,
          target: mysqlPackRef,
          createNamespace: mysqlCreateNamespace,
          enumInferenceCodecs: { text: MYSQL_ENUM_CODEC_ID, int: MYSQL_INT_CODEC_ID },
        });

  return coreDefineConfig({
    family: sql,
    target: mysql,
    adapter: mysqlAdapter,
    driver: mysqlDriver,
    extensions: options.extensions ?? [],
    contract,
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
  });
}
