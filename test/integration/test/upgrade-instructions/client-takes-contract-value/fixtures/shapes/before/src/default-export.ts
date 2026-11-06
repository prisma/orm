import sqlite from '@prisma/orm-sqlite/runtime';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const db = sqlite<Contract>({ contractJson, path: './dev.db' });

export default db;
