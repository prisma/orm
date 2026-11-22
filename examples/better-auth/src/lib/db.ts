import sqlite from '@prisma/orm-sqlite/runtime';
import { contractFromJson } from '@prisma/orm-sqlite/static';
import type { Contract } from '../prisma/contract';
import contractJson from '../prisma/contract.json' with { type: 'json' };

export const db = sqlite({
  contract: contractFromJson<Contract>(contractJson),
  path: process.env['SQLITE_PATH'] ?? './dev.db',
});
