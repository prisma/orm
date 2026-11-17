import sqliteAdapter from '@internal/adapter-sqlite/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import sqlite from '@internal/target-sqlite/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions: [],
    contract: {
      source: { format: 'typescript', load: async () => ({ ok: true as const, value: contract }) },
      output: 'contract.json',
      types: 'contract.d.ts',
    },
    db: { connection: '{{DB_PATH}}' },
    migrations: { dir: 'migrations' },
  }),
});
