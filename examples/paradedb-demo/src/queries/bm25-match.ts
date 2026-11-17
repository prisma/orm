import { db } from '../prisma/db';

export async function bm25Match(query: string, limit = 20) {
  const plan = db.sql.public.item
    .select('id', 'description', 'category', 'rating')
    .where((f, fns) => fns.paradeDbMatch(f.description, query))
    .limit(limit)
    .build();
  return db.query(plan);
}
