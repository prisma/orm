import sqliteAdapter from '@internal/adapter-sqlite/control';
import { defineConfig as ormConfig } from '@internal/cli/config-types';
import sqliteDriver from '@internal/driver-sqlite/control';
import sql from '@internal/family-sql/control';
import { typescriptContract } from '@internal/sql-contract-ts/config-types';
import sqlite from '@internal/target-sqlite/control';
import { definePrismaConfig } from '@prisma/cli-engine';
import { contract } from './contract';
import { extensions } from './packs';

export default definePrismaConfig({
  orm: ormConfig({
    family: sql,
    target: sqlite,
    adapter: sqliteAdapter,
    driver: sqliteDriver,
    extensions,
    contract: typescriptContract(contract, 'output/contract.json'),
  }),
});
