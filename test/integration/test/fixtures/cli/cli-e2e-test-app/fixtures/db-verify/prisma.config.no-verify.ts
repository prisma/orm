import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import type { ControlFamilyDescriptor } from '@internal/framework-components/control';
import { sqlEmission } from '@internal/sql-contract-emitter';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

// Create family descriptor without create method
// This tests validation that requires create method
const sqlFamilyWithoutCreate = {
  kind: 'family' as const,
  familyId: 'sql' as const,
  manifest: { id: 'sql', version: '0.0.1' },
  emission: sqlEmission,
  // create method is missing - this is what we're testing
};

export default definePrismaConfig({
  orm: ormConfig({
    // Test fixture - intentionally missing create method to test validation
    family: sqlFamilyWithoutCreate as unknown as ControlFamilyDescriptor<'sql'>,
    target: postgres,
    adapter: postgresAdapter,
    driver: postgresDriver,
    extensions: [],
    contract: {
      source: {
        load: async () => ({ ok: true, value: contract }),
      },
      output: 'output/contract.json',
    },
    db: {
      connection: '{{DB_URL}}', // Placeholder to be replaced in tests
    },
  }),
});
