import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const {
  orm: applicationDatabaseClient,
  contract,
  ...remainingClientMembers
} = sqlite<Contract>({ contractJson, path: './dev.db' });
