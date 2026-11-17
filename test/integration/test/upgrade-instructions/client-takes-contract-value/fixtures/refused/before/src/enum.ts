import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

enum contract {
  main = 0,
}

export const db = sqlite<Contract>({ contractJson, path: `./${contract.main}.db` });
