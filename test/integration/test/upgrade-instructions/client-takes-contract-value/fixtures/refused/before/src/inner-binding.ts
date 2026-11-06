import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export function open() {
  const contract = 'main';
  return sqlite<Contract>({ contractJson, path: `./${contract}.db` });
}
