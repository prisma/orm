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
  type CapabilitiesByVersion,
  type PostgresVersion,
  postgresCapabilitiesByVersion,
} from '@internal/target-postgres/server-version';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import {
  contractCapabilitiesFor,
  type PostgresCapabilitiesInput,
  supportedVersionsText,
} from '../contract/contract-capabilities';
import { postgresError } from '../errors';
import { contractBuilderModule, contractTypesModule, controlComponents } from './components';
import { moduleBase } from './module-base';

/**
 * A contract file and the database it is written for. A Prisma schema (`.prisma`, a glob or a directory) states the PostgreSQL `version` and the optional `capabilities` list here; a TypeScript contract (`.ts`) states them in `defineContract`.
 */
export type PostgresContractEntry<Version extends number = PostgresVersion> =
  | { readonly path: `${string}.ts`; readonly version?: never; readonly capabilities?: never }
  | ({ readonly path: string } & PostgresCapabilitiesInput<Version>);

export interface PostgresConfigOptions<Version extends number = PostgresVersion> {
  /** The contract entry, a TypeScript contract path, or a ready `ContractConfig` such as `prisma7Schema(...)`. A ready `ContractConfig` writes the capabilities it was given and no others. */
  readonly contract: `${string}.ts` | PostgresContractEntry<Version> | ContractConfig;
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
  readonly version?: unknown;
  readonly capabilities?: unknown;
}

function isContractEntry(contract: object): contract is UntypedEntry {
  return Object.hasOwn(contract, 'path');
}

function contractConfigFromEntry(
  table: CapabilitiesByVersion,
  entry: UntypedEntry,
  output: string,
): ContractConfig {
  if (extname(entry.path) === '.ts') {
    if (entry.version !== undefined || entry.capabilities !== undefined) {
      throw postgresError(
        'CONTRACT.ARGUMENT_INVALID',
        `The TypeScript contract "${entry.path}" states its PostgreSQL version and capabilities in defineContract. Remove version and capabilities from its contract entry in the config.`,
        { meta: { contract: entry.path } },
      );
    }
    return typescriptContractFromPath(entry.path, output, postgresContractTarget);
  }
  const capabilities = contractCapabilitiesFor(
    table,
    blindCast<PostgresCapabilitiesInput<number>, 'checked by contractCapabilitiesFor'>(entry),
    `State the PostgreSQL version your database runs beside the contract path, for example contract: { path: '${entry.path}', version: 18 }. ${supportedVersionsText}`,
  );
  return prismaContract(entry.path, {
    output,
    target: postgresPackRef,
    createNamespace: postgresCreateNamespace,
    enumInferenceCodecs: { text: PG_TEXT_CODEC_ID, int: PG_INT_CODEC_ID },
    capabilities,
  });
}

function resolveContractConfig(
  table: CapabilitiesByVersion,
  options: PostgresConfigOptions<number>,
): ContractConfig {
  const explicitOutput =
    options.output !== undefined ? join(options.output, 'contract.json') : undefined;
  const contract = options.contract;
  if (typeof contract === 'string' || isContractEntry(contract)) {
    const entry: UntypedEntry = typeof contract === 'string' ? { path: contract } : contract;
    return contractConfigFromEntry(
      table,
      entry,
      explicitOutput ?? defaultContractOutputPath(entry.path),
    );
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

/** The PostgreSQL `defineConfig` for `table`. The facade exports it for the table Prisma 8 ships; tests pass a table whose rows differ. */
export function defineConfigFor<const Table extends CapabilitiesByVersion>(table: Table) {
  return function defineConfig(
    options: PostgresConfigOptions<keyof Table & number>,
  ): PrismaConfig<'sql', 'postgres'> {
    const contractConfig = resolveContractConfig(table, options);
    return coreDefineConfig({
      ...controlComponents,
      extensions: options.extensions ?? [],
      contract: { ...contractConfig, typesModule: contractTypesModule },
      migrations: { ...options.migrations, module: `${moduleBase}/migration` },
      ...ifDefined('db', options.db),
      ...ifDefined('formatter', options.formatter),
    });
  };
}

export const defineConfig: (options: PostgresConfigOptions) => PrismaConfig<'sql', 'postgres'> =
  defineConfigFor(postgresCapabilitiesByVersion);
