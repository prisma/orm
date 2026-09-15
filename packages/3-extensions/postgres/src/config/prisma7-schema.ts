import type { ContractConfig } from '@internal/config/config-types';
import { prisma7Schema as sqlPrisma7Schema } from '@internal/sql-contract-prisma7/provider';
import { prisma7PostgresBinding } from '@internal/target-postgres/prisma7-binding';
import { ifDefined } from '@internal/utils/defined';

export interface Prisma7SchemaOptions {
  /** Path of the emitted `contract.json`. Defaults to `contract.json` next to the schema. */
  readonly output?: string;
}

/**
 * Reads a Prisma 7 `schema.prisma` (or a directory of `.prisma` files) as the
 * contract source, so Prisma 8 can adopt a database Prisma 7 still migrates.
 */
export function prisma7Schema(schemaPath: string, options?: Prisma7SchemaOptions): ContractConfig {
  return sqlPrisma7Schema(schemaPath, {
    ...ifDefined('output', options?.output),
    binding: prisma7PostgresBinding,
  });
}
