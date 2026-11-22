import sqlite from '@prisma/orm-sqlite/runtime';
import { contractFromJson } from '@prisma/orm-sqlite/static';
import contractJson from '../prisma/contract.json' with { type: 'json' };

export const db = sqlite({ contract: contractFromJson(contractJson), path: './dev.db' });
