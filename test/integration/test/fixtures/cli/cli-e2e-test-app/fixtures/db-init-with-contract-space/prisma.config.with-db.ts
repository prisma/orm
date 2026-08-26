import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import testContractSpaceExtension from '../../../../contract-space-fixture/control';
import { contract } from './contract';

// Declares a contract-space-publishing extension but does not emit any
// pinned `migrations/<space-id>/` artefacts on disk. Used by the
// contract-space verifier integration tests to exercise the
// `declaredButUnmigrated` violation path (AC-16).
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [testContractSpaceExtension],
    contract: {
      source: {
        load: async () => ({ ok: true, value: contract }),
      },
      output: 'src/prisma/contract.json',
    },
    db: {
      connection: '{{DB_URL}}',
    },
  }),
});
