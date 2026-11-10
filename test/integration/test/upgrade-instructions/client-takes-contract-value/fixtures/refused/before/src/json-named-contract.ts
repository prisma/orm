import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contract from './contract.json' with { type: 'json' };

export const db = postgres<Contract>({ contractJson: contract });
