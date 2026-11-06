import type { DemoOrm } from '../prisma/db';

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
    readonly avgDecimal: string | null;
  };
  readonly impressions: { readonly sum: GuardedTotal; readonly sumBigInt: bigint | null };
  readonly reach: { readonly sum: bigint | null; readonly sumBigInt: bigint | null };
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
 * `count`, `sum` and `avg` answer in the type a JavaScript developer expects — a
 * `number`. Where a total cannot be one, the codec throws instead of handing
 * back a rounded value, and `countBigInt`, `sumBigInt` and `avgDecimal` are the
 * exact answers to reach for.
 *
 * The seeded impressions make that concrete: no single row is anywhere near the
 * safe-integer range, but their total is 2^53 + 1000, so `sum('impressionCount')`
 * raises and `sumBigInt('impressionCount')` answers exactly. The guard is about
 * the value the aggregate produces, not the values it read.
 *
 * Each call is issued separately so one aggregate's guard cannot hide another
 * aggregate's answer.
 */
export async function ormClientGetEngagementPrecision(
  orm: DemoOrm,
): Promise<EngagementPrecisionReport> {
  const posts = await orm.Post.aggregate((aggregate) => ({
    count: aggregate.count(),
    countBigInt: aggregate.countBigInt(),
  }));

  // Views stay well inside the safe-integer range, so every operation answers.
  const views = await orm.Post.aggregate((aggregate) => ({
    sum: aggregate.sum('viewCount'),
    sumBigInt: aggregate.sumBigInt('viewCount'),
    avg: aggregate.avg('viewCount'),
    avgDecimal: aggregate.avgDecimal('viewCount'),
  }));

  const impressionSum = await guarded(() =>
    orm.Post.aggregate((aggregate) => ({ total: aggregate.sum('impressionCount') })),
  );
  const impressionSumBigInt = await orm.Post.aggregate((aggregate) => ({
    total: aggregate.sumBigInt('impressionCount'),
  }));

  // `reachScore` is `BigInt(storage: numeric)`, so even the bare `sum` is a `bigint`: a
  // column whose author already chose an exact representation keeps it, and a
  // sum of integers is an integer.
  const reach = await orm.Post.aggregate((aggregate) => ({
    sum: aggregate.sum('reachScore'),
    sumBigInt: aggregate.sumBigInt('reachScore'),
  }));

  return {
    posts,
    views,
    impressions: { sum: impressionSum, sumBigInt: impressionSumBigInt.total },
    reach,
  };
}
