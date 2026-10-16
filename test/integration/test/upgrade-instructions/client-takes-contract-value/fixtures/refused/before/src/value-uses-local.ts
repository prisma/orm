import { readFileSync } from 'node:fs';
import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';

const contractPath = new URL('./contract.json', import.meta.url);

export const db = postgres<Contract>({
  contractJson: JSON.parse(readFileSync(contractPath, 'utf8')),
});
