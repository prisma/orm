import type { ContractConfig, FormatterConfig, PrismaConfig } from '@internal/config/config-types';
import {
  defineConfig as coreDefineConfig,
  defaultContractOutputPath,
} from '@internal/config/config-types';
import type { ControlExtensionDescriptor } from '@internal/framework-components/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import {
  refuseOtherTargetOnLoad,
  typescriptContractFromPath,
} from '@internal/sql-contract-ts/config-types';
import { PG_INT_CODEC_ID, PG_TEXT_CODEC_ID } from '@internal/target-postgres/codec-ids';
import postgresPackRef from '@internal/target-postgres/pack';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import {
  type RequiredCapabilities,
  requiredCapabilitiesFor,
} from '../contract/contract-capabilities';
import { postgresError } from '../errors';
import { contractBuilderModule, contractTypesModule, controlComponents } from './components';
import { moduleBase } from './module-base';

/** The contract entry of a PostgreSQL config: a Prisma schema (`.prisma`, a glob or a directory) lists the capabilities it requires here, in `requiredCapabilities`; a TypeScript contract (`.ts`) lists them in `defineContract`, so its entry takes none. */
export type PostgresContractEntry<Path extends string = string> = {
  readonly path: Path;
} & (Path extends `${string}.ts`
  ? { readonly requiredCapabilities?: never }
  : { readonly requiredCapabilities: RequiredCapabilities });

/** The options of the PostgreSQL `defineConfig`. */
export interface PostgresConfigOptions<Path extends string = string> {
  /** The contract entry, a TypeScript contract path, or a ready `ContractConfig` such as `prisma7Schema(...)`. A ready `ContractConfig` writes the capabilities it was given and no others. */
  readonly contract: `${string}.ts` | PostgresContractEntry<Path> | ContractConfig;
  readonly output?: string;
  readonly db?: {
    readonly connection?: string;
  };
  readonly extensions?: readonly ControlExtensionDescriptor<'sql', 'postgres'>[];
  readonly migrations?: {
    readonly dir?: string;
  };
  readonly formatter?: FormatterConfig;
}

const postgresContractTarget = { target: postgresPackRef, contractBuilderModule };

interface UntypedEntry {
  readonly path: string;
  readonly requiredCapabilities?: RequiredCapabilities;
}

function isContractEntry(contract: object): contract is UntypedEntry {
  return Object.hasOwn(contract, 'path');
}

function contractConfigFromEntry(entry: UntypedEntry, output: string): ContractConfig {
  if (extname(entry.path) === '.ts') {
    if (entry.requiredCapabilities !== undefined) {
      throw postgresError(
        'CONTRACT.ARGUMENT_INVALID',
        `The TypeScript contract "${entry.path}" lists the capabilities it requires in defineContract. Remove requiredCapabilities from its contract entry in the config.`,
        { meta: { contract: entry.path } },
      );
    }
    return typescriptContractFromPath(entry.path, output, postgresContractTarget);
  }
  const capabilities = requiredCapabilitiesFor(
    entry.requiredCapabilities,
    `beside the contract path '${entry.path}' in the config`,
  );
  return prismaContract(entry.path, {
    output,
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
    capabilities,
  });
}

function resolveContractConfig(options: {
  readonly contract: `${string}.ts` | UntypedEntry | ContractConfig;
  readonly output?: string | undefined;
}): ContractConfig {
  const explicitOutput =
    options.output !== undefined ? join(options.output, 'contract.json') : undefined;
  const contract = options.contract;
  if (typeof contract === 'string' || isContractEntry(contract)) {
    const entry: UntypedEntry = typeof contract === 'string' ? { path: contract } : contract;
    return contractConfigFromEntry(entry, explicitOutput ?? defaultContractOutputPath(entry.path));
  }
  const firstInput = contract.source.inputs?.[0];
  const output =
    explicitOutput ??
    contract.output ??
    (firstInput !== undefined ? defaultContractOutputPath(firstInput) : undefined);
  return {
    ...refuseOtherTargetOnLoad(contract, postgresContractTarget),
    ...ifDefined('output', output),
  };
}

/** The PostgreSQL `defineConfig`. */
export function defineConfig<const Path extends string>(
  options: PostgresConfigOptions<Path>,
): PrismaConfig<'sql', 'postgres'> {
  const contractConfig = resolveContractConfig(options);
  return coreDefineConfig({
    ...controlComponents,
    extensions: options.extensions ?? [],
    contract: { ...contractConfig, typesModule: contractTypesModule },
    migrations: { ...options.migrations, module: `${moduleBase}/migration` },
    ...ifDefined('db', options.db),
    ...ifDefined('formatter', options.formatter),
  });
}
