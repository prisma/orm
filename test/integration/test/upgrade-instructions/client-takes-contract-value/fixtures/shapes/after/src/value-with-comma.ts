import { readFileSync } from 'node:fs';
import postgres from '@prisma/orm-postgres/runtime';
import { contractFromJson } from '@prisma/orm-postgres/static';
import type { Contract } from './contract.d';

export const contract = contractFromJson<Contract>(JSON.parse(readFileSync('./c.json', 'utf8')));

export const db = postgres({
  contract,
  url: process.env['DATABASE_URL'],
});
