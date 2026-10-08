import { readFileSync } from 'node:fs';
import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import postgresDriver from '@internal/driver-postgres/control';
import sql from '@internal/family-sql/control';
import postgres from '@internal/target-postgres/control';
import { definePrismaConfig } from '@prisma/cli-engine';

const { valueObjectStorageType: _declaredByPostgres, ...authoring } = postgresAdapter.authoring;

// A stack whose adapter declares no value-object storage type loads a contract
// emitted by the Postgres stack, which stores value objects in jsonb columns.
export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: postgres,
    adapter: { ...postgresAdapter, authoring },
    driver: postgresDriver,
    extensions: [],
    contract: {
      source: {
        format: 'typescript',
        load: async () => ({
          ok: true,
          value: JSON.parse(
            readFileSync(new URL('./contract-input.json', import.meta.url), 'utf8'),
          ),
        }),
      },
      output: 'output/contract.json',
    },
    db: { connection: '{{DB_URL}}' },
    migrations: { dir: 'migrations' },
  }),
});
