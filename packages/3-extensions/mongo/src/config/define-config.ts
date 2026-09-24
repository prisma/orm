import { MONGO_INT32_CODEC_ID, MONGO_STRING_CODEC_ID } from '@internal/adapter-mongo/codec-ids';
import mongoAdapter from '@internal/adapter-mongo/control';
import type { PrismaNextConfig } from '@internal/config/config-types';
import { defineConfig as coreDefineConfig } from '@internal/config/config-types';
import mongoDriver from '@internal/driver-mongo/control';
import { mongoFamilyDescriptor } from '@internal/family-mongo/control';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { mongoContract } from '@internal/mongo-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/mongo-contract-ts/config-types';
import { mongoTargetDescriptor } from '@internal/target-mongo/control';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import { isDynamicPattern } from 'tinyglobby';

export interface MongoConfigOptions {
  readonly contract: string;
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

export function defineConfig(options: MongoConfigOptions): PrismaNextConfig<'mongo', 'mongo'> {
  const extensions = options.extensions ?? [];
  const output =
    options.output !== undefined
      ? join(options.output, 'contract.json')
      : deriveOutputPath(options.contract);
  const ext = extname(options.contract);

  const contractConfig =
    ext === '.ts'
      ? typescriptContractFromPath(options.contract, output)
      : mongoContract(options.contract, {
          output,
          enumInferenceCodecs: { text: MONGO_STRING_CODEC_ID, int: MONGO_INT32_CODEC_ID },
        });

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
