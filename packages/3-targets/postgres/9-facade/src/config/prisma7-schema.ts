import type { ContractConfig } from '@internal/config/config-types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import {
  type RequiredCapabilities,
  requiredCapabilitiesFor,
} from '../contract/contract-capabilities';

/** What a Prisma 7 schema contract requires of its database and its connection. */
export interface Prisma7SchemaOptions {
  /** Everything the contract requires, each capability as its key: `[...postgres18, ...postgresDriver]`. The list must not be empty. */
  readonly requiredCapabilities: RequiredCapabilities;
}

/**
 * Reads a Prisma 7 `schema.prisma` (or a directory of `.prisma` files) as the
 * contract source, so Prisma 8 can adopt a database Prisma 7 still migrates.
 */
export function prisma7Schema(schemaPath: string, options: Prisma7SchemaOptions): ContractConfig {
  const capabilities = requiredCapabilitiesFor(
    options?.requiredCapabilities,
    `in the options of prisma7Schema('${schemaPath}')`,
  );
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding, capabilities });
}
