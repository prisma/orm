import { resolve } from 'pathe';
import type { ContractConfig, PrismaNextConfig } from './config-types';

/**
 * The key under which a config section carries its path resolver until a loader
 * has resolved it against the file that wrote it. `Symbol.for` so the key is the
 * same across every copy of this package in a dependency tree.
 */
export const CONFIG_RESOLVE: unique symbol = Symbol.for('prisma.config.resolve');

export type ConfigResolver<TConfig> = (rootDir: string) => TConfig;

export interface UnresolvedConfig<TConfig> {
  readonly [CONFIG_RESOLVE]: ConfigResolver<TConfig>;
}

export function isUnresolvedConfig(value: unknown): value is UnresolvedConfig<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    typeof (value as Partial<UnresolvedConfig<unknown>>)[CONFIG_RESOLVE] === 'function'
  );
}

type ContractSourceProvider = NonNullable<PrismaNextConfig['contract']>['source'];

/** A value that is not a string is left for validation to report. */
function resolveAuthored(rootDir: string, value: string): string {
  return typeof value === 'string' ? resolve(rootDir, value) : value;
}

function resolveContractSource(
  source: ContractSourceProvider,
  rootDir: string,
): ContractSourceProvider {
  const inputs = source.inputs;
  return Array.isArray(inputs)
    ? { ...source, inputs: inputs.map((input) => resolveAuthored(rootDir, input)) }
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

export function resolveContractConfig(contract: ContractConfig, rootDir: string): ContractConfig {
  const normalized = normalizeContractConfig(contract);
  return {
    ...normalized,
    ...(normalized.source ? { source: resolveContractSource(normalized.source, rootDir) } : {}),
    output: resolveAuthored(rootDir, normalized.output),
  };
}

const DEFAULT_MIGRATIONS_DIR = 'migrations';

type MigrationsConfig = NonNullable<PrismaNextConfig['migrations']>;

export function resolveMigrationsConfig(
  migrations: PrismaNextConfig['migrations'],
  rootDir: string,
): PrismaNextConfig['migrations'] {
  return migrations?.dir === undefined
    ? migrations
    : { ...migrations, dir: resolveAuthored(rootDir, migrations.dir) };
}

/**
 * Supplies the defaults a section may omit, anchored on its `rootDir`. Applied
 * once, after every layer has been resolved and merged, so a layer's default
 * never shadows a value another layer authored.
 */
export function withConfigDefaults<TConfig extends PrismaNextConfig>(
  config: TConfig & { readonly rootDir: string },
): TConfig & { readonly migrations: MigrationsConfig & { readonly dir: string } } {
  return {
    ...config,
    migrations: {
      ...config.migrations,
      dir: config.migrations?.dir ?? resolve(config.rootDir, DEFAULT_MIGRATIONS_DIR),
    },
  };
}

/**
 * Resolves every authored path in the ORM config section against `rootDir`,
 * the directory of the config file that wrote it, and records `rootDir` on the
 * section. Defaults are not supplied here; see {@link withConfigDefaults}.
 * Idempotent: an absolute path resolves to itself.
 */
export function resolveConfigPaths<TConfig extends PrismaNextConfig>(
  config: TConfig,
  rootDir: string,
): TConfig {
  const { [CONFIG_RESOLVE]: _resolver, ...authored } = config as TConfig &
    Partial<UnresolvedConfig<TConfig>>;
  return {
    ...(authored as TConfig),
    rootDir,
    ...(config.contract ? { contract: resolveContractConfig(config.contract, rootDir) } : {}),
    ...(config.migrations
      ? { migrations: resolveMigrationsConfig(config.migrations, rootDir) }
      : {}),
  };
}

/** Attaches the resolver a loader calls once it knows which file wrote the section. */
export function withPathResolver<TConfig extends PrismaNextConfig>(
  config: TConfig,
): TConfig & UnresolvedConfig<TConfig> {
  return { ...config, [CONFIG_RESOLVE]: (rootDir: string) => resolveConfigPaths(config, rootDir) };
}

/**
 * Resolves the section if it still carries its resolver; a section that was
 * resolved already, or never carried one, is returned unchanged.
 */
export function resolveConfigSection(value: unknown, rootDir: string): unknown {
  return isUnresolvedConfig(value) ? value[CONFIG_RESOLVE](rootDir) : value;
}
