import postgresAdapter from '@internal/adapter-postgres/control';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import postgres from '@internal/target-postgres/control';
import { contract } from './contract';

// Deliberately NOT created by definePrismaConfig: the loader rejects unmarked configs
// with CONFIG.VERSION_MARKER_MISSING.
export default {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  driver: postgresDriver,
  extensions: [],
  contract: typescriptContract(contract),
};
