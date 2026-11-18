import type { ContractConfig, FormatterConfig, PrismaConfig } from '@internal/config/config-types';
import {
  defineConfig as coreDefineConfig,
  defaultContractOutputPath,
} from '@internal/config/config-types';
import type { TargetPackRef } from '@internal/framework-components/components';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/sql-contract-ts/config-types';
import { MYSQL_ENUM_CODEC_ID, MYSQL_INT_CODEC_ID } from '@internal/target-mysql/codec-ids';
import mysqlPackRef from '@internal/target-mysql/pack';
import { mysqlCreateNamespace } from '@internal/target-mysql/types';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import { typescriptContractNotTs } from '../errors';
import { contractTypesModule, controlComponents, migrationModule } from './components';

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
  readonly formatter?: FormatterConfig;
}

/** The components of MySQL, or of a target that extends it, that its `prisma.config.ts` wires together. The target and adapter are the ones the target package hands on, with their type declarations restated. */
export interface MysqlConfigComponents<TargetId extends string> {
  readonly pack: TargetPackRef<'sql', TargetId>;
  readonly family: PrismaConfig<'sql', TargetId>['family'];
  readonly target: PrismaConfig<'sql', TargetId>['target'];
  readonly adapter: PrismaConfig<'sql', TargetId>['adapter'];
  readonly driver: NonNullable<PrismaConfig<'sql', TargetId>['driver']>;
  /** The module a generated `contract.d.ts` imports the contract types from. */
  readonly typesModule: string;
  /** The module a generated `migration.ts` imports the migration helpers from. */
  readonly migrationModule: string;
}

const otherTypescriptExtensions: ReadonlySet<string> = new Set(['.mts', '.cts', '.tsx']);

function contractOutput(options: Pick<MysqlConfigOptions, 'contract' | 'output'>): string {
  return options.output !== undefined
    ? join(options.output, 'contract.json')
    : defaultContractOutputPath(options.contract);
}

function buildConfig<TargetId extends string>(
  components: MysqlConfigComponents<TargetId>,
  options: MysqlConfigOptions<TargetId>,
  contract: ContractConfig,
): PrismaConfig<'sql', TargetId> {
  return coreDefineConfig({
    family: components.family,
    target: components.target,
    adapter: components.adapter,
    driver: components.driver,
    extensions: options.extensions ?? [],
    contract: { ...contract, typesModule: components.typesModule },
    migrations: { ...options.migrations, module: components.migrationModule },
    ...ifDefined('db', options.db),
    ...ifDefined('formatter', options.formatter),
  });
}

/**
 * The `defineConfig` of MySQL, or of a target that extends it, built from that target's components. The contract is a TypeScript contract in a `.ts` file, or a Prisma schema: a `.prisma` file, a folder of them, or a glob. An `enum` block of text members is typed as a native MySQL enum, and one of integer members as `int`.
 */
export function createMysqlDefineConfig<TargetId extends string>(
  components: MysqlConfigComponents<TargetId>,
): (options: MysqlConfigOptions<TargetId>) => PrismaConfig<'sql', TargetId> {
  return (options) => {
    const extension = extname(options.contract);
    if (extension === '.ts') {
      return buildConfig(
        components,
        options,
        typescriptContractFromPath(options.contract, contractOutput(options)),
      );
    }
    if (otherTypescriptExtensions.has(extension)) {
      throw typescriptContractNotTs(components.pack.targetId, options.contract);
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
  ...controlComponents,
  pack: mysqlPackRef,
  typesModule: contractTypesModule,
  migrationModule,
};

/** The `prisma.config.ts` of a MySQL project, whose contract is a Prisma schema or a TypeScript contract. */
export const defineConfig: (options: MysqlConfigOptions) => PrismaConfig<'sql', 'mysql'> =
  createMysqlDefineConfig(mysqlComponents);
