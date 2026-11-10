import { mysqlAdapterCapabilities } from './capabilities';

/** What this adapter adds to every contract it runs: its capabilities. `prisma contract emit` reads them through the adapter's descriptor, and the TypeScript `defineContract` passes them to the contract build. */
export const mysqlAdapterContractContributions = {
  capabilities: mysqlAdapterCapabilities,
} as const;
