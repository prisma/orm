import { readFileSync } from 'node:fs';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';

export const db = postgres<Contract>({
  contractJson: JSON.parse(readFileSync('./c.json', 'utf8')),
  url: process.env['DATABASE_URL'],
});
