export type { CapabilitySet } from '@internal/sql-contract-ts/contract-builder';
export type { PostgresConfigOptions, PostgresContractEntry } from '../config/define-config';
export { defineConfig } from '../config/define-config';
export { type Prisma7SchemaOptions, prisma7Schema } from '../config/prisma7-schema';
export {
  type PostgresCapabilitiesInput,
  postgresContractCapabilities,
} from '../contract/contract-capabilities';
