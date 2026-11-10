import { db } from '../prisma/db';

export async function bm25ChainDemo() {
  const plan = db.sql.public.item
    .select('id', 'description', 'category', 'rating')
    .select('score', (f, fns) => fns.paradeDbScore(f.id))
    .where((f, fns) =>
      fns.paradeDbMatch(
        f.description,
        fns
          .paradeDbProximity('wireless')
          .within(1, 'mechanical')
          .within(1, 'keyboard', { ordered: true }),
      ),
    )
    .orderBy((f, fns) => fns.paradeDbScore(f.id), { direction: 'desc' })
    .limit(5)
    .build();
  return db.query(plan);
}
