import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientBm25TopMatches(query: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Item.where((item) => item.description.paradeDbMatch(query))
    .orderBy((item) => item.id.paradeDbScore().desc())
    .limit(limit)
    .all();
}
