import postgres from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const { contract } = postgres<Contract>({ contractJson });

export const tables = Object.keys(contract.storage.namespaces);
