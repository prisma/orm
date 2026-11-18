import type { DemoOrm } from '../prisma/db';

/**
 * An extension-contributed aggregate, called like any other.
 *
 * `stddev` is not one of the operations the PostgreSQL target declares — it
 * reaches this surface because `src/extensions/engagement-stats.ts` contributes
 * a descriptor for it, and both the emitted types and the runtime registry read
 * their operation set from what the composed stack declared. The call below is
 * fully typed: `stddev` sits beside `count` and `avg` on the same builder, and
 * its result is the decimal string its descriptor declared.
 */
export interface EngagementSpread {
  readonly posts: number;
  readonly meanViews: number | null;
  /** `stddev` declares `pg/numeric@1`, so its result is an exact decimal string. */
  readonly viewSpread: string | null;
  readonly impressionSpread: string | null;
}

export async function ormClientGetEngagementSpread(orm: DemoOrm): Promise<EngagementSpread> {
  return orm.Post.aggregate((aggregate) => ({
    posts: aggregate.count(),
    meanViews: aggregate.avg('viewCount'),
    viewSpread: aggregate.stddev('viewCount'),
    impressionSpread: aggregate.stddev('impressionCount'),
  }));
}
