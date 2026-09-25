import type { ContractConfig } from '@internal/config/config-types';
import { prisma6Contract } from '@internal/mongo-contract-prisma6/provider';
import { prisma6MongoBinding } from '@internal/target-mongo/prisma6-binding';

/**
 * Reads a Prisma 6 MongoDB `schema.prisma` (or a directory of `.prisma` files) as the
 * contract source, so Prisma 8 can adopt a database a Prisma 6 application still uses.
 */
export function prisma6Schema(schemaPath: string): ContractConfig {
  return prisma6Contract(schemaPath, { binding: prisma6MongoBinding });
}
