import mariadb from '@prisma/orm-mariadb/runtime';
import { contractFromJson } from '@prisma/orm-mariadb/static';
import type { Contract } from './contract.d';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

/** A client for the database at `url`. It connects on its first query. */
export function createDb(url: string) {
  return mariadb({ contract, url });
}

export type Db = ReturnType<typeof createDb>;
