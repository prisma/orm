import * as facade from '@prisma/orm-postgres/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const postgres = facade.default;

export const db = postgres<Contract>({ contractJson });
