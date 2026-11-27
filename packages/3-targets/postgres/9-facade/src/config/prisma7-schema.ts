import type { ContractConfig } from '@internal/config/config-types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import {
  defaultRequiredCapabilities,
  type RequiredCapabilities,
  requiredCapabilitiesFor,
} from '../contract/contract-capabilities';
import { configModule } from './module-base';
import { warnWhenRequiredCapabilitiesDefaulted } from './required-capabilities-not-listed';

/** What a Prisma 7 schema contract requires of its database and its connection. */
export interface Prisma7SchemaOptions {
  /**
   * Everything the contract requires, each capability as its key: `[...postgres18, ...postgresDriver]`. The list must not be empty.
   *
   * A call that leaves it out requires the newest PostgreSQL version's list and the driver's, and `prisma contract emit` warns. That default is a stopgap for configs written before the list existed: Prisma 8.0 removes it and requires the list.
   */
  readonly requiredCapabilities?: RequiredCapabilities;
}

/**
 * Reads a Prisma 7 `schema.prisma` (or a directory of `.prisma` files) as the
 * contract source, so Prisma 8 can adopt a database Prisma 7 still migrates.
 */
export function prisma7Schema(schemaPath: string, options?: Prisma7SchemaOptions): ContractConfig {
  const listed = options?.requiredCapabilities;
  const where = `in the options of prisma7Schema('${schemaPath}')`;
  const capabilities = requiredCapabilitiesFor(
    listed === undefined ? defaultRequiredCapabilities : listed,
    where,
  );
  return warnWhenRequiredCapabilitiesDefaulted(
    prisma7Contract(schemaPath, { binding: prisma7PostgresBinding, capabilities }),
    { where, module: configModule, path: schemaPath },
    () => listed === undefined,
  );
}
