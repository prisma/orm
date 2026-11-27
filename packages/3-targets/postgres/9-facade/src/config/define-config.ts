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
  defaultRequiredCapabilities,
  hasDefaultRequiredCapabilities,
  type RequiredCapabilities,
  requiredCapabilitiesFor,
} from '../contract/contract-capabilities';
import { postgresError } from '../errors';
import { contractBuilderModule, contractTypesModule, controlComponents } from './components';
import { PrismaSchemaContractEntry } from './contract-entry-nodes';
import { moduleBase } from './module-base';
import {
  asTheContractEntry,
  defaultRequiredCapabilitiesOfReadySource,
  inDefineContract,
  warnWhenRequiredCapabilitiesDefaulted,
} from './required-capabilities-not-listed';

/**
 * The contract entry of a PostgreSQL config: a Prisma schema (`.prisma`, a glob or a directory) lists the capabilities it requires here, in `requiredCapabilities`; a TypeScript contract (`.ts`) lists them in `defineContract`, so its entry takes none.
 *
 * A Prisma schema whose entry leaves the list out, or that is given as a bare path, requires the newest PostgreSQL version's list and the driver's, and `prisma contract emit` warns. That default is a stopgap for configs written before the list existed: Prisma 8.0 removes it and requires the list.
 */
export type PostgresContractEntry<Path extends string = string> = {
  readonly path: Path;
} & (Path extends `${string}.ts`
  ? { readonly requiredCapabilities?: never }
  : { readonly requiredCapabilities?: RequiredCapabilities });

/** The options of the PostgreSQL `defineConfig`. */
export interface PostgresConfigOptions<Path extends string = string> {
  /** The contract entry, a contract path, or a ready `ContractConfig` such as `prisma7Schema(...)`. A ready `ContractConfig` writes the capabilities it was given; one given none requires the newest PostgreSQL version's list and the driver's, and `prisma contract emit` warns, until Prisma 8.0 removes that default. */
  readonly contract: string | PostgresContractEntry<Path> | ContractConfig;
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
    return warnWhenRequiredCapabilitiesDefaulted(
      typescriptContractFromPath(entry.path, output, postgresContractTarget),
      inDefineContract(entry.path),
      hasDefaultRequiredCapabilities,
    );
  }
  const where = `beside the contract path '${entry.path}' in the config`;
  const capabilities = requiredCapabilitiesFor(
    entry.requiredCapabilities === undefined
      ? defaultRequiredCapabilities
      : entry.requiredCapabilities,
    where,
  );
  const config = prismaContract(entry.path, {
    output,
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
    capabilities,
  });
  return warnWhenRequiredCapabilitiesDefaulted(
    config,
    asTheContractEntry(new PrismaSchemaContractEntry(entry.path), entry.path),
    () => entry.requiredCapabilities === undefined,
  );
}

function resolveContractConfig(options: {
  readonly contract: string | UntypedEntry | ContractConfig;
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
    ...refuseOtherTargetOnLoad(
      defaultRequiredCapabilitiesOfReadySource(contract),
      postgresContractTarget,
    ),
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
