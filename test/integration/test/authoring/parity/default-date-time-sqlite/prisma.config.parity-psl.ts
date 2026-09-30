import sqliteAdapter from '@internal/adapter-sqlite/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { prismaContract } from '@internal/sql-contract-psl/provider';
import sqlite, { sqliteCreateNamespace } from '@internal/target-sqlite/control';
import sqlitePackRef from '@internal/target-sqlite/pack';
import { definePrismaConfig } from '@prisma/cli-engine';
import { extensions } from './packs';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions,
    contract: prismaContract('./schema.prisma', {
      output: 'output/contract.json',
      target: sqlitePackRef,
      createNamespace: sqliteCreateNamespace,
    }),
  }),
});
