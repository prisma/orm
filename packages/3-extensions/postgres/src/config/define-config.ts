import postgresAdapter from '@internal/adapter-postgres/control';
import type { ContractConfig, PrismaNextConfig } from '@internal/config/config-types';
import { defineConfig as coreDefineConfig } from '@internal/config/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/sql-contract-ts/config-types';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgres from '@internal/target-postgres/control';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import { isDynamicPattern } from 'tinyglobby';

export interface PostgresConfigOptions {
  /** A contract file path (`.prisma` or `.ts`), or a ready `ContractConfig` such as `prisma7Schema(...)`. */
  readonly contract: string | ContractConfig;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
  readonly migrations?: {
    readonly dir?: string;
  };
}

function staticPrefixDirectory(pattern: string): string {
  const staticSegments: string[] = [];
  for (const segment of pattern.replaceAll('\\', '/').split('/')) {
    if (isDynamicPattern(segment)) break;
    staticSegments.push(segment);
  }
  return staticSegments.join('/');
}

function deriveOutputPath(contractPath: string): string {
  if (isDynamicPattern(contractPath)) {
    const prefix = staticPrefixDirectory(contractPath);
    return prefix.length === 0 ? 'contract.json' : `${prefix}/contract.json`;
  }
  const ext = extname(contractPath);
  if (ext.length === 0) {
    return `${contractPath}.json`;
  }
  return `${contractPath.slice(0, -ext.length)}.json`;
}

function contractConfigFromPath(contractPath: string, output: string): ContractConfig {
  return extname(contractPath) === '.ts'
    ? typescriptContractFromPath(contractPath, output)
    : prismaContract(contractPath, {
        output,
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
        enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
      });
}

function resolveContractConfig(options: PostgresConfigOptions): ContractConfig {
  const explicitOutput =
    options.output !== undefined ? join(options.output, 'contract.json') : undefined;
  if (typeof options.contract === 'string') {
    return contractConfigFromPath(
      options.contract,
      explicitOutput ?? deriveOutputPath(options.contract),
    );
  }
  const firstInput = options.contract.source.inputs?.[0];
  const output =
    explicitOutput ??
    options.contract.output ??
    (firstInput !== undefined ? deriveOutputPath(firstInput) : undefined);
  return { ...options.contract, ...ifDefined('output', output) };
}

export function defineConfig(options: PostgresConfigOptions): PrismaNextConfig<'sql', 'postgres'> {
  const extensions = options.extensions ?? [];
  const contractConfig = resolveContractConfig(options);

  return coreDefineConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions,
    contract: contractConfig,
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
  });
}
