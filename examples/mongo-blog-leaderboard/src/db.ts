import mongo from '@prisma/orm-mongo/runtime';
import { contractFromJson } from '@prisma/orm-mongo/static';
import { ifDefined } from '@prisma/orm-mongo/utils/defined';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export function createClient(options: { url: string; dbName?: string }) {
  return mongo({
    contract,
    url: options.url,
    ...ifDefined('dbName', options.dbName),
  });
}

export type Db = ReturnType<typeof createClient>;
