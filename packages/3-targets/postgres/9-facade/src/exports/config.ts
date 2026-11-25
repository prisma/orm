export type { CapabilityMatrix } from '@internal/framework-components/components';
export type {
  PostgresConfigOptions,
  PostgresContractEntry,
  PostgresDefineConfig,
} from '../config/define-config';
export { defineConfig } from '../config/define-config';
export { type Prisma7SchemaOptions, prisma7Schema } from '../config/prisma7-schema';
export {
  type CapabilitiesList,
  type DefaultConnectionCapabilities,
  type PostgresCapabilitiesInput,
  type PostgresContractCapabilities,
  postgresContractCapabilities,
} from '../contract/contract-capabilities';
