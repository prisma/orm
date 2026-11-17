import type { FormatterConfig, PrismaNextConfig } from '@internal/config/config-types';
import {
  defineConfig as coreDefineConfig,
  defaultContractOutputPath,
} from '@internal/config/config-types';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import { typescriptContractFromPath } from '@internal/sql-contract-ts/config-types';
import { SQLITE_INTEGER_CODEC_ID, SQLITE_TEXT_CODEC_ID } from '@internal/target-sqlite/codec-ids';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { sqliteCreateNamespace } from '@internal/target-sqlite/types';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import { controlComponents, generatedTypesModule } from './components';
import { moduleBase } from './module-base';

export interface SqliteConfigOptions {
  readonly contract: string;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'sqlite'>[];
  readonly migrations?: {
    readonly dir?: string;
  };
  readonly formatter?: FormatterConfig;
}

export function defineConfig(options: SqliteConfigOptions): PrismaNextConfig<'sql', 'sqlite'> {
  const extensions = options.extensions ?? [];
  const output =
    options.output !== undefined
      ? join(options.output, 'contract.json')
      : defaultContractOutputPath(options.contract);
  const ext = extname(options.contract);

  const contractConfig =
    ext === '.ts'
      ? typescriptContractFromPath(options.contract, output)
      : prismaContract(options.contract, {
          output,
          target: sqlitePackRef,
          createNamespace: sqliteCreateNamespace,
          enumInferenceCodecs: { text: SQLITE_TEXT_CODEC_ID, int: SQLITE_INTEGER_CODEC_ID },
        });

  return coreDefineConfig({
    ...controlComponents,
    extensions,
    contract: { ...contractConfig, typesModule: generatedTypesModule },
    migrations: { ...options.migrations, module: `${moduleBase}/migration` },
    ...ifDefined('db', options.db),
    ...ifDefined('formatter', options.formatter),
  });
}
