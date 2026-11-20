import { mysqlAdapterContractContributions } from '@internal/adapter-mysql/adapter';
import { mariadbAdapterCapabilities } from './capabilities';

/** What this adapter adds to every contract it runs: MySQL's aggregate overloads and MariaDB's capabilities. `prisma contract emit` reads them through the adapter's descriptor, and the TypeScript `defineContract` passes them to the contract build. */
export const mariadbAdapterContractContributions = {
  ...mysqlAdapterContractContributions,
  capabilities: mariadbAdapterCapabilities,
} as const;
