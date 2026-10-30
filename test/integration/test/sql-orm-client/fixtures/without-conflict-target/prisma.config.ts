import { postgresAdapterCapabilities } from '@internal/adapter-postgres/adapter';
import postgresAdapter from '@internal/adapter-postgres/control';
import { defineConfig as ormConfig } from '@internal/postgres/config';
import { definePrismaConfig } from '@prisma/cli-engine';

const { insertOnConflictTarget: _target, ...sql } = postgresAdapterCapabilities.sql;

const orm = ormConfig({ contract: './contract.prisma', output: 'generated' });

export default definePrismaConfig({
  orm: {
    ...orm,
    adapter: { ...postgresAdapter, capabilities: { ...postgresAdapterCapabilities, sql } },
  },
});
