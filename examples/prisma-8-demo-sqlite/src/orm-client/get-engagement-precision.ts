import { db } from '../prisma/db';

/**
 * What a bare aggregate answered with: either the total, or the structured
 * error the guarded codec raised instead of rounding it.
 */
export type GuardedTotal =
  | { readonly kind: 'total'; readonly total: number | null }
  | { readonly kind: 'guarded'; readonly code: string; readonly message: string };

export interface EngagementPrecisionReport {
  readonly posts: { readonly count: number; readonly countBigInt: bigint };
  readonly views: {
    readonly sum: number | null;
    readonly sumBigInt: bigint | null;
    readonly avg: number | null;
  };
  readonly impressions: { readonly sum: GuardedTotal; readonly sumBigInt: bigint | null };
}

/** The error a guarded integer codec raises for a value it cannot hand back as a `number`. */
const DECODE_FAILED = 'RUNTIME.DECODE_FAILED';

function errorCode(error: unknown): string | null {
  if (typeof error !== 'object' || error === null || !Object.hasOwn(error, 'code')) {
    return null;
  }
  const code = Reflect.get(error, 'code');
  return typeof code === 'string' ? code : null;
}

/**
 * Runs one bare aggregate and reports the guard as a result rather than a
 * crash. Only the range guard is caught — any other failure is a real one and
 * is rethrown.
 */
async function guarded(run: () => Promise<{ total: number | null }>): Promise<GuardedTotal> {
  try {
    const { total } = await run();
    return { kind: 'total', total };
  } catch (error) {
    if (errorCode(error) !== DECODE_FAILED) {
      throw error;
    }
    return {
      kind: 'guarded',
      code: DECODE_FAILED,
      message: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * The bare aggregate operations beside their lossless variants.
 *
 * SQLite states the same defaults policy as PostgreSQL in its own terms:
 * `count`, `sum` and `avg` answer as JavaScript numbers, with `count` and an
 * integer `sum` throwing instead of rounding, and `countBigInt` / `sumBigInt`
 * answering exactly. There is no `avgDecimal` here at all — an exact mean needs
 * a decimal result codec and SQLite has none, so the method is absent from the
 * contract's types rather than failing at runtime.
 *
 * The seeded impressions total 2^53 + 1000, which is what makes
 * `sum('impressionCount')` raise and `sumBigInt('impressionCount')` answer.
 */
export async function ormClientGetEngagementPrecision(): Promise<EngagementPrecisionReport> {
  const posts = await db.orm.Post.aggregate((aggregate) => ({
    count: aggregate.count(),
    countBigInt: aggregate.countBigInt(),
  }));

  const views = await db.orm.Post.aggregate((aggregate) => ({
    sum: aggregate.sum('viewCount'),
    sumBigInt: aggregate.sumBigInt('viewCount'),
    avg: aggregate.avg('viewCount'),
  }));

  const impressionSum = await guarded(() =>
    db.orm.Post.aggregate((aggregate) => ({ total: aggregate.sum('impressionCount') })),
  );
  const impressionSumBigInt = await db.orm.Post.aggregate((aggregate) => ({
    total: aggregate.sumBigInt('impressionCount'),
  }));

  return {
    posts,
    views,
    impressions: { sum: impressionSum, sumBigInt: impressionSumBigInt.total },
  };
}
