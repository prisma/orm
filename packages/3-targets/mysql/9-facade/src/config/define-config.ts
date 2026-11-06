import mysqlAdapter from '@internal/adapter-mysql/control';
import type { ContractConfig, PrismaNextConfig } from '@internal/config/config-types';
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
import { prismaContractRequired } from '../errors';

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

/** The components of MySQL, or of a target that extends it, that its `prisma.config.ts` wires together. The control target carries the facade module its `migration.ts` files import from. */
export interface MysqlConfigComponents<TargetId extends string> {
  readonly pack: TargetPackRef<'sql', TargetId>;
  readonly target: PrismaNextConfig<'sql', TargetId>['target'];
  readonly adapter: PrismaNextConfig<'sql', TargetId>['adapter'];
  readonly driver: NonNullable<PrismaNextConfig<'sql', TargetId>['driver']>;
}

function contractOutput(options: Pick<MysqlConfigOptions, 'contract' | 'output'>): string {
  return options.output !== undefined
    ? join(options.output, 'contract.json')
    : defaultContractOutputPath(options.contract);
}

function buildConfig<TargetId extends string>(
  components: MysqlConfigComponents<TargetId>,
  options: MysqlConfigOptions<TargetId>,
  contract: ContractConfig,
): PrismaNextConfig<'sql', TargetId> {
  return coreDefineConfig({
    family: sql,
    target: components.target,
    adapter: components.adapter,
    driver: components.driver,
    extensions: options.extensions ?? [],
    contract,
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
  });
}

/**
 * The `defineConfig` of MySQL, or of a target that extends it, built from that target's components. The contract must be a `.prisma` schema; an `enum` block of text members is typed as a native MySQL enum, and one of integer members as `int`.
 */
export function createMysqlDefineConfig<TargetId extends string>(
  components: MysqlConfigComponents<TargetId>,
): (options: MysqlConfigOptions<TargetId>) => PrismaNextConfig<'sql', TargetId> {
  return (options) => {
    if (extname(options.contract) !== '.prisma') {
      throw prismaContractRequired(components.pack.targetId, options.contract);
    }
    return buildConfig(
      components,
      options,
      prismaContract(options.contract, {
        output: contractOutput(options),
        target: components.pack,
        createNamespace: mysqlCreateNamespace,
        enumInferenceCodecs: { text: MYSQL_ENUM_CODEC_ID, int: MYSQL_INT_CODEC_ID },
      }),
    );
  };
}

const mysqlComponents: MysqlConfigComponents<'mysql'> = {
  pack: mysqlPackRef,
  target: mysql,
  adapter: mysqlAdapter,
  driver: mysqlDriver,
};

const mysqlPslDefineConfig = createMysqlDefineConfig(mysqlComponents);

/** The `prisma.config.ts` of a MySQL project, whose contract is a `.prisma` schema or a TypeScript contract. */
export function defineConfig(options: MysqlConfigOptions): PrismaNextConfig<'sql', 'mysql'> {
  if (extname(options.contract) === '.ts') {
    return buildConfig(
      mysqlComponents,
      options,
      typescriptContractFromPath(options.contract, contractOutput(options)),
    );
  }
  return mysqlPslDefineConfig(options);
}
