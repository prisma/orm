import { db } from '../prisma/db';

export async function bm25Proximity(term1: string, term2: string, distance: number, limit = 20) {
  const plan = db.sql.public.item
    .select('id', 'description', 'category', 'rating')
    .select('score', (f, fns) => fns.paradeDbScore(f.id))
    .where((f, fns) =>
      fns.paradeDbMatch(f.description, fns.paradeDbProximity(term1).within(distance, term2)),
    )
    .orderBy((f, fns) => fns.paradeDbScore(f.id), { direction: 'desc' })
    .limit(limit)
    .build();
  return db.query(plan);
}
