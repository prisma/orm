import mongoAdapter from '@internal/adapter-mongo/control';
import type { ContractConfig, PrismaNextConfig } from '@internal/config/config-types';
import { defineConfig as coreDefineConfig } from '@internal/config/config-types';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/mongo-contract-ts/config-types';
import { MONGO_INT32_CODEC_ID, MONGO_STRING_CODEC_ID } from '@internal/target-mongo/codec-ids';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import { isDynamicPattern } from 'tinyglobby';

export interface MongoConfigOptions {
  /** A contract file path (`.prisma` or `.ts`), or a ready `ContractConfig` such as `prisma6Schema(...)`. */
  readonly contract: string | ContractConfig;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'mongo', 'mongo'>[];
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
    : mongoContract(contractPath, {
        output,
        enumInferenceCodecs: { text: MONGO_STRING_CODEC_ID, int: MONGO_INT32_CODEC_ID },
      });
}

function resolveContractConfig(options: MongoConfigOptions): ContractConfig {
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

export function defineConfig(options: MongoConfigOptions): PrismaNextConfig<'mongo', 'mongo'> {
  const extensions = options.extensions ?? [];
  const contractConfig = resolveContractConfig(options);

  return coreDefineConfig({
    family: mongoFamilyDescriptor,
    target: mongoTargetDescriptor,
    adapter: mongoAdapter,
    driver: mongoDriver,
    extensions,
    contract: contractConfig,
    ...ifDefined('db', options.db),
    ...ifDefined('migrations', options.migrations),
  });
}
