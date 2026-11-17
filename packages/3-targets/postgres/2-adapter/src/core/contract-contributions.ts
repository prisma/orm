import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { postgresAggregateDescriptors } from '@internal/target-postgres/aggregates';
import { postgresAdapterCapabilities } from './capabilities';

/**
 * What this adapter adds to every contract it runs: its capabilities and the aggregate overloads it lists. `prisma contract emit` reads them through the adapter's descriptor, and the TypeScript `defineContract` passes them to the contract build.
 */
export const postgresAdapterContractContributions = {
  capabilities: postgresAdapterCapabilities,
  types: {
    aggregateDescriptors:
      postgresAggregateDescriptors satisfies ReadonlyArray<SqlAggregateDescriptor>,
  },
} as const;
