import { defineConfig as ormConfig } from '@internal/postgres/config';
import { postgresServerVersions } from '@internal/target-postgres/server-version';
import { definePrismaConfig } from '@prisma/cli-engine';

const { insertOnConflictTarget: _target, ...sql } = postgresServerVersions[18].sql;

const orm = ormConfig({
  contract: { path: './contract.prisma', version: 18 },
  output: 'generated',
});

export default definePrismaConfig({
  orm: {
    ...orm,
    target: { ...orm.target, capabilities: { ...postgresServerVersions[18], sql } },
  },
});
