import { createCacheMiddleware } from '@prisma/orm-extension-middleware-cache';
import type { MongoRuntime } from '@prisma/orm-mongo/family-runtime';
import mongo from '@prisma/orm-mongo/runtime';
import { contractFromJson } from '@prisma/orm-mongo/static';
import type { Contract } from './contract';
import contractJson from './contract.json' with { type: 'json' };

export const contract = contractFromJson<Contract>(contractJson);

export async function createClient(connectionUri: string, dbName: string) {
  const db = mongo({
    contract,
    url: connectionUri,
    dbName,
    middleware: [createCacheMiddleware()],
  });
  const runtime = await db.runtime();
  return { orm: db.orm, runtime, query: db.query, contract: db.contract, enums: db.enums };
}

export type Db = Awaited<ReturnType<typeof createClient>>;
export type { MongoRuntime };
