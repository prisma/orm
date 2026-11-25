import type { ContractConfig } from '@internal/config/config-types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import type { CapabilitySet } from '@internal/sql-contract-ts/contract-builder';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import {
  type CapabilitiesByVersion,
  type PostgresVersion,
  postgresCapabilitiesByVersion,
} from '@internal/target-postgres/server-version';
import {
  contractCapabilitiesFor,
  type PostgresCapabilitiesInput,
  supportedVersionsText,
} from '../contract/contract-capabilities';

/** The database a Prisma 7 schema contract is written for: the PostgreSQL `version` and the optional `capabilities` list. */
export type Prisma7SchemaOptions<Version extends number = PostgresVersion> =
  PostgresCapabilitiesInput<Version, readonly CapabilitySet[]>;

/** `prisma7Schema` for `table`. The facade exports it for the table Prisma 8 ships; tests pass a table whose rows differ. */
export function prisma7SchemaFor<const Table extends CapabilitiesByVersion>(table: Table) {
  return function prisma7Schema(
    schemaPath: string,
    options: Prisma7SchemaOptions<keyof Table & number>,
  ): ContractConfig {
    const capabilities = contractCapabilitiesFor(
      table,
      options ?? {},
      `State the PostgreSQL version your database runs beside the Prisma 7 schema path, for example prisma7Schema('${schemaPath}', { version: 18 }). ${supportedVersionsText}`,
    );
    return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding, capabilities });
  };
}

/**
 * Reads a Prisma 7 `schema.prisma` (or a directory of `.prisma` files) as the
 * contract source, so Prisma 8 can adopt a database Prisma 7 still migrates.
 */
export const prisma7Schema: (schemaPath: string, options: Prisma7SchemaOptions) => ContractConfig =
  prisma7SchemaFor(postgresCapabilitiesByVersion);
