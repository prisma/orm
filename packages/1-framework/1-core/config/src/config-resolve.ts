import { resolve } from 'pathe';
import type { ContractConfig, PrismaNextConfig } from './config-types';

type ContractSourceProvider = NonNullable<PrismaNextConfig['contract']>['source'];

/** A value that is not a string is left for validation to report. */
function resolveAuthored(baseDir: string, value: string): string {
  return typeof value === 'string' ? resolve(baseDir, value) : value;
}

function resolveContractSource(
  source: ContractSourceProvider,
  baseDir: string,
): ContractSourceProvider {
  const inputs = source.inputs;
  return Array.isArray(inputs)
    ? { ...source, inputs: inputs.map((input) => resolveAuthored(baseDir, input)) }
    : source;
}

/**
 * Default *source* directory for the contract file the user authors at `init`
 * time. Output artefacts colocate with source per the same rule path-bearing
 * providers apply.
 */
export const DEFAULT_CONTRACT_SOURCE_DIR = 'src/prisma';

export function normalizeContractConfig(
  contract: ContractConfig,
): ContractConfig & { readonly output: string } {
  // In-memory-only fallback: `typescriptContract(contract)` has no source path
  // to anchor on, so normalization supplies a default output colocated with
  // the default source directory.
  const inMemoryFallbackOutput = `${DEFAULT_CONTRACT_SOURCE_DIR}/contract.json`;
  return {
    source: contract.source,
    output: contract.output ?? inMemoryFallbackOutput,
  };
}

export function resolveContractConfig(contract: ContractConfig, baseDir: string): ContractConfig {
  const normalized = normalizeContractConfig(contract);
  return {
    ...normalized,
    ...(normalized.source ? { source: resolveContractSource(normalized.source, baseDir) } : {}),
    output: resolveAuthored(baseDir, normalized.output),
  };
}

const DEFAULT_MIGRATIONS_DIR = 'migrations';

type MigrationsConfig = NonNullable<PrismaNextConfig['migrations']>;

export function resolveMigrationsConfig(
  migrations: PrismaNextConfig['migrations'],
  baseDir: string,
): PrismaNextConfig['migrations'] {
  return migrations?.dir === undefined
    ? migrations
    : { ...migrations, dir: resolveAuthored(baseDir, migrations.dir) };
}

/**
 * Supplies the defaults a section may omit, anchored on its `baseDir`. Applied
 * once, after every layer has been resolved and merged, so a layer's default
 * never shadows a value another layer authored.
 */
export function withConfigDefaults<TConfig extends PrismaNextConfig>(
  config: TConfig & { readonly baseDir: string },
): TConfig & { readonly migrations: MigrationsConfig & { readonly dir: string } } {
  return {
    ...config,
    migrations: {
      ...config.migrations,
      dir: config.migrations?.dir ?? resolve(config.baseDir, DEFAULT_MIGRATIONS_DIR),
    },
  };
}

/**
 * Resolves every authored path in the ORM config section against `baseDir`,
 * the directory of the config file that wrote it, and records `baseDir` on the
 * section. Defaults are not supplied here; see {@link withConfigDefaults}.
 * Idempotent: an absolute path resolves to itself.
 */
export function resolveConfigPaths<TConfig extends PrismaNextConfig>(
  config: TConfig,
  baseDir: string,
): TConfig & { readonly baseDir: string } {
  return {
    ...config,
    baseDir,
    ...(config.contract ? { contract: resolveContractConfig(config.contract, baseDir) } : {}),
    ...(config.migrations
      ? { migrations: resolveMigrationsConfig(config.migrations, baseDir) }
      : {}),
  };
}
