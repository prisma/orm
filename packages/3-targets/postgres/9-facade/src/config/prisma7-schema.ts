import type { ContractConfig } from '@internal/config/config-types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import {
  type PostgresServerVersion,
  postgresServerVersions,
} from '@internal/target-postgres/server-version';
import {
  type CapabilitySet,
  capabilitiesForVersion,
  defaultConnectionCapabilities,
  mergeCapabilitySets,
} from '../contract/database-version';
import { postgresError } from '../errors';

/** The database a Prisma 7 schema contract is written for. */
export interface Prisma7SchemaOptions {
  /** The PostgreSQL version the database runs. The contract requires the capabilities that version provides. */
  readonly version: PostgresServerVersion;
  /**
   * The capabilities the connection provides, one set per component, merged in order. Defaults to those of the adapter and the driver the client runs with; a list given here replaces the default.
   */
  readonly capabilities?: readonly CapabilitySet[];
}

const databaseCapabilitiesBySource = new WeakMap<ContractConfig['source'], CapabilitySet>();

/** The capabilities of the version a `prisma7Schema` source was given, which `defineConfig` binds its target to. */
export function databaseCapabilitiesOfPrisma7Source(
  source: ContractConfig['source'],
): CapabilitySet | undefined {
  return databaseCapabilitiesBySource.get(source);
}

/**
 * Reads a Prisma 7 `schema.prisma` (or a directory of `.prisma` files) as the
 * contract source, so Prisma 8 can adopt a database Prisma 7 still migrates.
 */
export function prisma7Schema(schemaPath: string, options: Prisma7SchemaOptions): ContractConfig {
  if (options?.version === undefined) {
    throw postgresError(
      'CONTRACT.ARGUMENT_INVALID',
      `State the PostgreSQL version your database runs beside the Prisma 7 schema path, for example prisma7Schema('${schemaPath}', { version: 18 }). The supported versions are ${Object.keys(postgresServerVersions).join(', ')}.`,
      { meta: { contract: schemaPath } },
    );
  }
  const databaseCapabilities = capabilitiesForVersion(postgresServerVersions, options.version);
  const config = prisma7Contract(schemaPath, {
    binding: prisma7PostgresBinding,
    capabilities: mergeCapabilitySets(options.capabilities ?? defaultConnectionCapabilities),
  });
  databaseCapabilitiesBySource.set(config.source, databaseCapabilities);
  return config;
}
