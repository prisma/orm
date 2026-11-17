import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export function open() {
  const { sql, contract } = sqlite<Contract>({ contractJson, path: './dev.db' });
  return { sql, contract };
}
