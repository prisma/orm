import type { Geometry } from '@prisma/orm-extension-postgis/codec-types';
import { db } from '../prisma/db';

/**
 * Cafes whose spherical distance to `point` is at most `metres`.
 *
 * `ST_DistanceSphere` works on `geometry` (not just `geography`) and
 * returns metres on a sphere — the right tool for "within N metres of"
 * queries on lat/lng data without converting columns to geography.
 *
 * Ordering nearest-first with `id ASC` as a tie-breaker makes the
 * `.limit(limit)` slice the deterministic nearest-N rather than an
 * arbitrary subset when more cafes match the radius than `limit`.
 *
 * SQL: WHERE ST_DistanceSphere(location, $point) <= $metres
 *      ORDER BY ST_DistanceSphere(location, $point) ASC, id ASC
 *      LIMIT $limit
 */
export function findCafesWithinRadius(point: Geometry, metres: number, limit: number) {
  return db.orm.public.Cafe.where((c) => c.location.distanceSphere(point).lte(metres))
    .orderBy((c) => c.location.distanceSphere(point).asc())
    .orderBy((c) => c.id.asc())
    .limit(limit)
    .all();
}
