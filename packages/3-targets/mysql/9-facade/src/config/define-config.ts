import mysqlAdapter from '@internal/adapter-mysql/control';
import type { PrismaNextConfig } from '@internal/config/config-types';
import {
  defineConfig as coreDefineConfig,
  defaultContractOutputPath,
} from '@internal/config/config-types';
import mysqlDriver from '@internal/driver-mysql/control';
import sql from '@internal/family-sql/control';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/sql-contract-ts/config-types';
import { MYSQL_ENUM_CODEC_ID, MYSQL_INT_CODEC_ID } from '@internal/target-mysql/codec-ids';
import mysql from '@internal/target-mysql/control';
import mysqlPackRef from '@internal/target-mysql/pack';
import { mysqlCreateNamespace } from '@internal/target-mysql/types';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';

export interface MysqlConfigOptions<TargetId extends string = 'mysql'> {
  readonly contract: string;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', TargetId>[];
  readonly migrations?: {
    readonly dir?: string;
  };
}

/** The parts of MySQL, or of a target that extends it, that its `prisma.config.ts` wires together. The control target carries the facade module its `migration.ts` files import from. */
export interface MysqlConfigParts<TargetId extends string> {
  readonly pack: TargetPackRef<'sql', TargetId>;
  readonly target: PrismaNextConfig<'sql', TargetId>['target'];
  readonly adapter: PrismaNextConfig<'sql', TargetId>['adapter'];
  readonly driver: NonNullable<PrismaNextConfig<'sql', TargetId>['driver']>;
}

/**
 * The `defineConfig` of MySQL, or of a target that extends it, built from that target's parts. A `.prisma` contract types an `enum` block of text members as a native MySQL enum, and one of integer members as `int`.
 */
export function createMysqlDefineConfig<TargetId extends string>(
  parts: MysqlConfigParts<TargetId>,
): (options: MysqlConfigOptions<TargetId>) => PrismaNextConfig<'sql', TargetId> {
  return (options) => {
    const output =
      options.output !== undefined
        ? join(options.output, 'contract.json')
        : defaultContractOutputPath(options.contract);
    const contract =
      extname(options.contract) === '.ts'
        ? typescriptContractFromPath(options.contract, output)
        : prismaContract(options.contract, {
            output,
            target: parts.pack,
            createNamespace: mysqlCreateNamespace,
            enumInferenceCodecs: { text: MYSQL_ENUM_CODEC_ID, int: MYSQL_INT_CODEC_ID },
          });

    return coreDefineConfig({
      family: sql,
      target: parts.target,
      adapter: parts.adapter,
      driver: parts.driver,
      extensions: options.extensions ?? [],
      contract,
      ...ifDefined('db', options.db),
      ...ifDefined('migrations', options.migrations),
    });
  };
}

/** The `prisma.config.ts` of a MySQL project. */
export const defineConfig: (options: MysqlConfigOptions) => PrismaNextConfig<'sql', 'mysql'> =
  createMysqlDefineConfig({
    pack: mysqlPackRef,
    target: mysql,
    adapter: mysqlAdapter,
    driver: mysqlDriver,
  });
