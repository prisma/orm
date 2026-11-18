import mysql from '@prisma/orm-mysql/runtime';
import { contractFromJson } from '@prisma/orm-mysql/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

/** A client for the database at `url`. It connects on its first query. */
export function createDb(url: string) {
  return mysql({ contract, url });
}

export type Db = ReturnType<typeof createDb>;
