import sqlite from '@prisma/orm-sqlite/runtime';
import { contractFromJson } from '@prisma/orm-sqlite/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

const contract = contractFromJson<Contract>(contractJson);

const db = sqlite({ contract, path: './dev.db' });

export default db;
