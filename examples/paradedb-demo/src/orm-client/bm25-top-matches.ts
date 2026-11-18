import { db } from '../prisma/db';

export async function ormClientBm25TopMatches(query: string, limit: number) {
  return db.orm.public.Item.where((item) => item.description.paradeDbMatch(query))
    .orderBy((item) => item.id.paradeDbScore().desc())
    .limit(limit)
    .all();
}
