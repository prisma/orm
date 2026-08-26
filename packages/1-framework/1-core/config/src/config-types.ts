import type {
  ControlAdapterDescriptor,
  ControlDriverDescriptor,
  ControlDriverInstance,
  ControlExtensionDescriptor,
  ControlFamilyDescriptor,
  ControlTargetDescriptor,
} from '@internal/framework-components/control';
import type { ContractSourceProvider } from './contract-source-types';

/**
 * Type alias for CLI driver instances.
 * Uses string for both family and target IDs for maximum flexibility.
 */
export type CliDriver = ControlDriverInstance<string, string>;

/**
 * Contract configuration specifying source and artifact locations.
 */
export interface ContractConfig {
  /**
   * Contract source provider. The provider is always async and must return
   * a Result containing either a Contract or structured diagnostics.
   */
  readonly source: ContractSourceProvider;
  /**
   * Path to contract.json artifact. Providers that know an input path (PSL,
   * `typescriptContractFromPath`) derive an output colocated with that input
   * so this rarely needs to be set explicitly. The `.d.ts` types file is
   * always emitted next to the JSON (e.g., `contract.json` → `contract.d.ts`).
   */
  readonly output?: string;
}

export interface FormatterConfig {
  readonly indent?: number | 'tab';
  readonly newline?: 'LF' | 'CRLF';
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

/**
 * Configuration for Prisma Next CLI.
 * Uses Control*Descriptor types for type-safe wiring with compile-time compatibility checks.
 *
 * @template TFamilyId - The family ID (e.g., 'sql', 'document')
 * @template TTargetId - The target ID (e.g., 'postgres', 'mysql')
 * @template TConnection - The driver connection input type (defaults to `unknown` for config flexibility)
 */
export interface PrismaNextConfig<
  TFamilyId extends string = string,
  TTargetId extends string = string,
  TConnection = unknown,
> {
  readonly family: ControlFamilyDescriptor<TFamilyId>;
  readonly target: ControlTargetDescriptor<TFamilyId, TTargetId>;
  readonly adapter: ControlAdapterDescriptor<TFamilyId, TTargetId>;
  readonly extensions?: readonly ControlExtensionDescriptor<TFamilyId, TTargetId>[];
  /**
   * Driver descriptor for DB-connected CLI commands.
   * Required for DB-connected commands (e.g., db verify).
   * Optional for commands that don't need database access (e.g., emit).
   * The driver's connection type matches the TConnection config parameter.
   */
  readonly driver?: ControlDriverDescriptor<
    TFamilyId,
    TTargetId,
    ControlDriverInstance<TFamilyId, TTargetId>,
    TConnection
  >;
  /**
   * Database connection configuration.
   * The connection type is driver-specific (e.g., URL string for Postgres).
   */
  readonly db?: {
    /**
     * Driver-specific connection input.
     * For Postgres: a connection string (URL).
     * For other drivers: may be a structured object.
     */
    readonly connection?: TConnection;
  };
  /**
   * Contract configuration. Specifies source and artifact locations.
   * Required for emit command; optional for other commands that only read artifacts.
   */
  readonly contract?: ContractConfig;
  /**
   * Migration configuration. Controls where on-disk migration packages are stored.
   */
  readonly migrations?: {
    /** Directory for migration packages, relative to config file. Defaults to 'migrations'. */
    readonly dir?: string;
  };
  readonly formatter?: FormatterConfig;
}

/**
 * Builds the ORM section of `prisma.config.ts`. The result nests under the
 * `orm` key of the engine's `definePrismaConfig` — the marker lives on the envelope,
 * not here. Structural validation happens in the config loader, which reports
 * per-section diagnostics instead of failing the whole load.
 *
 * Normalization:
 * - contract.output defaults to a path colocated with DEFAULT_CONTRACT_SOURCE_DIR
 *   when missing (in-memory-only providers)
 *
 * @param config - Raw config input from user
 * @returns Normalized config IR with defaults applied
 */
export function defineConfig<TFamilyId extends string = string, TTargetId extends string = string>(
  config: PrismaNextConfig<TFamilyId, TTargetId>,
): PrismaNextConfig<TFamilyId, TTargetId> {
  if (config.contract) {
    return {
      ...config,
      contract: normalizeContractConfig(config.contract),
    };
  }

  // Return config as-is if no contract (preserve literal types)
  return config;
}
