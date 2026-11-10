import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({
  // don't open a pool until the first query
  contractJson,
  url: process.env['DATABASE_URL'],
});
