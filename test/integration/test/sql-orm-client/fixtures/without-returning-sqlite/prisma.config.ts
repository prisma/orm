import sqliteAdapter from '@internal/adapter-sqlite/control';
import { defineConfig as ormConfig } from '@internal/sqlite/config';
import { definePrismaConfig } from '@prisma/cli-engine';

const {
  returning: _returning,
  insertOnConflictTarget: _target,
  ...sql
} = sqliteAdapter.capabilities.sql;

const orm = ormConfig({ contract: './contract.prisma', output: 'generated' });

export default definePrismaConfig({
  orm: { ...orm, adapter: { ...sqliteAdapter, capabilities: { sql } } },
});
