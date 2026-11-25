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
import {
  type PostgresServerVersion,
  postgresServerVersions,
} from '@internal/target-postgres/server-version';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import {
  type CapabilitySet,
  capabilitiesForVersion,
  defaultConnectionCapabilities,
  mergeCapabilitySets,
} from '../contract/database-version';
import { postgresError } from '../errors';
import { contractBuilderModule, contractTypesModule, controlComponents } from './components';
import { moduleBase } from './module-base';

/** A contract file and, for a Prisma schema, the database it is written for. */
export interface PostgresContractEntry {
  /** The contract file: a Prisma schema (`.prisma`, a glob or a directory) or a TypeScript contract (`.ts`). */
  readonly path: string;
  /** The PostgreSQL version the database runs. Required for a Prisma schema; a TypeScript contract states it in `defineContract`. */
  readonly version?: PostgresServerVersion;
  /**
   * The capabilities the connection provides, one set per component, merged in order. Defaults to those of the adapter and the driver the client runs with; a list given here replaces the default.
   */
  readonly capabilities?: readonly CapabilitySet[];
}

export interface PostgresConfigOptions {
  /** The contract entry, a TypeScript contract path, or a ready `ContractConfig` such as `prisma7Schema(...)`. */
  readonly contract: string | PostgresContractEntry | ContractConfig;
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

const SUPPORTED_VERSIONS = Object.keys(postgresServerVersions).join(', ');

function isContractEntry(
  contract: PostgresConfigOptions['contract'],
): contract is PostgresContractEntry {
  return typeof contract === 'object' && Object.hasOwn(contract, 'path');
}

function contractEntryOf(contract: string | PostgresContractEntry): PostgresContractEntry {
  return typeof contract === 'string' ? { path: contract } : contract;
}

/** The capabilities the version of a Prisma schema contract provides, or none for a TypeScript contract, which binds its own target. */
function databaseCapabilitiesOf(entry: PostgresContractEntry): CapabilitySet {
  if (extname(entry.path) === '.ts') {
    if (entry.version !== undefined || entry.capabilities !== undefined) {
      throw postgresError(
        'CONTRACT.ARGUMENT_INVALID',
        `The TypeScript contract "${entry.path}" states its PostgreSQL version and capabilities in defineContract. Remove version and capabilities from its contract entry in the config.`,
        { meta: { contract: entry.path } },
      );
    }
    return {};
  }
  if (entry.version === undefined) {
    throw postgresError(
      'CONTRACT.ARGUMENT_INVALID',
      `State the PostgreSQL version your database runs beside the contract path, for example contract: { path: '${entry.path}', version: 18 }. The supported versions are ${SUPPORTED_VERSIONS}.`,
      { meta: { contract: entry.path } },
    );
  }
  return capabilitiesForVersion(postgresServerVersions, entry.version);
}

function contractConfigFromEntry(entry: PostgresContractEntry, output: string): ContractConfig {
  return extname(entry.path) === '.ts'
    ? typescriptContractFromPath(entry.path, output, postgresContractTarget)
    : prismaContract(entry.path, {
        output,
        target: postgresPackRef,
        createNamespace: postgresCreateNamespace,
        enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
        capabilities: mergeCapabilitySets(entry.capabilities ?? defaultConnectionCapabilities),
      });
}

function resolveContractConfig(options: PostgresConfigOptions): ContractConfig {
  const explicitOutput =
    options.output !== undefined ? join(options.output, 'contract.json') : undefined;
  if (typeof options.contract === 'string' || isContractEntry(options.contract)) {
    const entry = contractEntryOf(options.contract);
    return contractConfigFromEntry(entry, explicitOutput ?? defaultContractOutputPath(entry.path));
  }
  const firstInput = options.contract.source.inputs?.[0];
  const output =
    explicitOutput ??
    options.contract.output ??
    (firstInput !== undefined ? defaultContractOutputPath(firstInput) : undefined);
  return {
    ...refuseOtherTargetOnLoad(options.contract, postgresContractTarget),
    ...ifDefined('output', output),
  };
}

export function defineConfig(options: PostgresConfigOptions): PrismaConfig<'sql', 'postgres'> {
  const extensions = options.extensions ?? [];
  const contractConfig = resolveContractConfig(options);
  const databaseCapabilities =
    typeof options.contract === 'string' || isContractEntry(options.contract)
      ? databaseCapabilitiesOf(contractEntryOf(options.contract))
      : {};

  return coreDefineConfig({
    ...controlComponents,
    target: { ...controlComponents.target, capabilities: databaseCapabilities },
    extensions,
    contract: { ...contractConfig, typesModule: contractTypesModule },
    migrations: { ...options.migrations, module: `${moduleBase}/migration` },
    ...ifDefined('db', options.db),
    ...ifDefined('formatter', options.formatter),
  });
}
