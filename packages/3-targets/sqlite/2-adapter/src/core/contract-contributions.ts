import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { sqliteAggregateDescriptors } from '@internal/target-sqlite/aggregates';
import { sqliteAdapterCapabilities } from './capabilities';

/**
 * What this adapter adds to every contract it runs: its capabilities and the aggregate overloads it lists. `prisma contract emit` reads them through the adapter's descriptor, and the TypeScript `defineContract` passes them to the contract build.
 */
export const sqliteAdapterContractContributions = {
  capabilities: sqliteAdapterCapabilities,
  types: {
    aggregateDescriptors:
      sqliteAggregateDescriptors satisfies ReadonlyArray<SqlAggregateDescriptor>,
  },
} as const;
