import { db } from '../prisma/db';

export async function bm25TopByScore(query: string, limit = 10) {
  const plan = db.sql.public.item
    .select('id', 'description', 'category', 'rating')
    .select('score', (f, fns) => fns.paradeDbScore(f.id))
    .where((f, fns) => fns.paradeDbMatch(f.description, query))
    .orderBy((f, fns) => fns.paradeDbScore(f.id), { direction: 'desc' })
    .limit(limit)
    .build();
  return db.query(plan);
}
