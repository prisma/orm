import type { ContractSourceContext } from '@internal/config/config-types';
import type { ControlStack } from '@internal/framework-components/control';
import { postgresContractCapabilities } from '@internal/postgres/config';
import { contractSourceContextFromControlStack } from '@internal/psl-parser/test';

/**
 * The context a PostgreSQL Prisma schema contract is interpreted with, at version 18 and the default connection capabilities, as the facade's config resolves them. The control stack's descriptors declare no capabilities, so a context built from the stack alone gives the contract none.
 */
export function postgresPslContext(stack: ControlStack): ContractSourceContext {
  return contractSourceContextFromControlStack(stack, {
    capabilities: postgresContractCapabilities({ databaseVersion: 18 }),
  });
}
