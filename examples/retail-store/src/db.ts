import { createCacheMiddleware } from '@prisma/orm-extension-middleware-cache';
import mongo from '@prisma/orm-mongo/runtime';
import { contract } from './contract-value';

export function createClient(connectionUri: string, dbName: string) {
  return mongo({
    contract,
    url: connectionUri,
    dbName,
    middleware: [createCacheMiddleware()],
  });
}

export type Db = ReturnType<typeof createClient>;

let db: Db | undefined;

export function getDb(): Db {
  if (!db) {
    const url = process.env['DB_URL'] ?? 'mongodb://localhost:27017';
    const dbName = process.env['MONGODB_DB'] ?? 'retail-store';
    db = createClient(url, dbName);
  }
  return db;
}
