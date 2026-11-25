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
  postgresCapabilitiesByVersion,
} from '@internal/target-postgres/server-version';
import { postgresCreateNamespace } from '@internal/target-postgres/types';
import { blindCast } from '@internal/utils/casts';
import { ifDefined } from '@internal/utils/defined';
import { extname, join } from 'pathe';
import {
  type CapabilitiesInputFor,
  type CapabilitiesList,
  contractCapabilitiesFor,
  type PostgresCapabilitiesInput,
  supportedVersionsText,
} from '../contract/contract-capabilities';
import { postgresError } from '../errors';
import { contractBuilderModule, contractTypesModule, controlComponents } from './components';
import { moduleBase } from './module-base';

/**
 * A contract file and the database it is written for, for any table of versions. A Prisma schema (`.prisma`, a glob or a directory) states the PostgreSQL `databaseVersion` and the optional `capabilities` list here; a TypeScript contract (`.ts`) states them in `defineContract`, so its entry takes neither.
 */
type ContractEntryFor<Version extends number, Path extends string = string> = {
  readonly path: Path;
} & (Path extends `${string}.ts`
  ? { readonly databaseVersion?: never; readonly capabilities?: never }
  : CapabilitiesInputFor<Version, CapabilitiesList>);

/** The contract entry of a PostgreSQL config: a Prisma schema states its PostgreSQL `databaseVersion` and optional `capabilities` list here; a TypeScript contract (`.ts`) takes neither. */
export type PostgresContractEntry<Path extends string = string> = {
  readonly path: Path;
} & (Path extends `${string}.ts`
  ? { readonly databaseVersion?: never; readonly capabilities?: never }
  : PostgresCapabilitiesInput);

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

/** The options of a `defineConfig` for any table of versions. */
type ConfigOptionsFor<Version extends number, Path extends string = string> = Omit<
  PostgresConfigOptions<Path>,
  'contract'
> & {
  readonly contract: `${string}.ts` | ContractEntryFor<Version, Path> | ContractConfig;
};

const postgresContractTarget = { target: postgresPackRef, contractBuilderModule };

interface UntypedEntry {
  readonly path: string;
  readonly databaseVersion?: unknown;
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
    if (entry.databaseVersion !== undefined || entry.capabilities !== undefined) {
      throw postgresError(
        'CONTRACT.ARGUMENT_INVALID',
        `The TypeScript contract "${entry.path}" states its PostgreSQL version and capabilities in defineContract. Remove databaseVersion and capabilities from its contract entry in the config.`,
        { meta: { contract: entry.path } },
      );
    }
    return typescriptContractFromPath(entry.path, output, postgresContractTarget);
  }
  const capabilities = contractCapabilitiesFor(
    table,
    blindCast<
      CapabilitiesInputFor<number, CapabilitiesList>,
      'contractCapabilitiesFor refuses a missing or unsupported version and a capabilities value that is not a list'
    >(entry),
    `State the PostgreSQL version your database runs beside the contract path, for example contract: { path: '${entry.path}', databaseVersion: 18 }. ${supportedVersionsText}`,
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
  options: {
    readonly contract: `${string}.ts` | UntypedEntry | ContractConfig;
    readonly output?: string | undefined;
  },
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
  return function defineConfig<const Path extends string>(
    options: ConfigOptionsFor<keyof Table & number, Path>,
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

/** The type of the PostgreSQL `defineConfig`. */
export type PostgresDefineConfig = <const Path extends string>(
  options: PostgresConfigOptions<Path>,
) => PrismaConfig<'sql', 'postgres'>;

export const defineConfig: PostgresDefineConfig = defineConfigFor(postgresCapabilitiesByVersion);
