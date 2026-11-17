import type { ContractConfig } from '@internal/config/config-types';
import { prisma7Contract } from '@internal/sql-contract-prisma7/provider';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';

/**
 * Reads a Prisma 7 `schema.prisma` (or a directory of `.prisma` files) as the
 * contract source, so Prisma 8 can adopt a database Prisma 7 still migrates.
 */
export function prisma7Schema(schemaPath: string): ContractConfig {
  return prisma7Contract(schemaPath, { binding: prisma7PostgresBinding });
}
