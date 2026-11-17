import { db } from '../prisma/db';

export interface ProximityChainStep {
  readonly distance: number;
  readonly term: string;
  readonly ordered: boolean;
}

export async function bm25ProximityChain(
  start: string,
  steps: readonly ProximityChainStep[],
  limit = 20,
) {
  const plan = db.sql.public.item
    .select('id', 'description', 'category', 'rating')
    .select('score', (f, fns) => fns.paradeDbScore(f.id))
    .where((f, fns) => {
      const chain = steps.reduce(
        (acc, step) => acc.within(step.distance, step.term, { ordered: step.ordered }),
        fns.paradeDbProximity(start),
      );
      return fns.paradeDbMatch(f.description, chain);
    })
    .orderBy((f, fns) => fns.paradeDbScore(f.id), { direction: 'desc' })
    .limit(limit)
    .build();
  return db.query(plan);
}
