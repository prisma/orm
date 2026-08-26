import postgresAdapter from '@internal/adapter-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { contract } from './contract';

// This config does not include driver
// Manually create config without definePrismaConfig to bypass validation (testing error case)
export default {
  family: sql,
  target: postgres,
  adapter: postgresAdapter,
  // driver is missing - this is what we're testing
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
};
