import type { SqlAggregateDescriptor } from '@internal/sql-relational-core/aggregate-descriptor-registry';
import { postgresAggregateDescriptors } from '@internal/target-postgres/aggregates';

/**
 * The aggregate overloads this adapter lists, which every contract it runs carries. `prisma contract emit` reads them through the adapter's descriptor, and the TypeScript `defineContract` passes them to the contract build. A contract requires capabilities only through the author's `requiredCapabilities` list.
 */
export const postgresAdapterContractContributions = {
  types: {
    aggregateDescriptors:
      postgresAggregateDescriptors satisfies ReadonlyArray<SqlAggregateDescriptor>,
  },
} as const;
