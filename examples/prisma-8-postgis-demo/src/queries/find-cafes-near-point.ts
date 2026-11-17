import type { Geometry } from '@prisma/orm-extension-postgis/codec-types';
import { db } from '../prisma/db';

/**
 * Order all cafes by spherical distance to a query point and return the
 * closest `limit` rows, projecting the distance as a `meters` field.
 *
 * Stays on the SQL builder (not the ORM `db.orm.public.Cafe` collection)
 * because the result row needs an arbitrary computed column
 * (`distanceSphere(location, point) AS meters`) alongside the model
 * fields. The ORM collection surface exposes the predicate (`.lte`),
 * the order helper (`.asc`/`.desc`), and model-field projection, but
 * not arbitrary expression projection — that's the seam where the SQL
 * builder is the right tool.
 *
 * The `id ASC` tie-breaker after the distance ordering keeps the
 * truncated `LIMIT` slice deterministic when two cafes happen to sit
 * at exactly the same spherical distance from the query point.
 *
 * SQL shape:
 *   SELECT id, name, ST_DistanceSphere(location, $point) AS meters
 *   FROM cafe
 *   ORDER BY ST_DistanceSphere(location, $point) ASC, id ASC
 *   LIMIT $limit
 */
export function findCafesNearPoint(point: Geometry, limit: number) {
  const plan = db.sql.public.cafe
    .select('id', 'name')
    .select('meters', (f, fns) => fns.distanceSphere(f.location, point))
    .orderBy((f, fns) => fns.distanceSphere(f.location, point), { direction: 'asc' })
    .orderBy((f) => f.id, { direction: 'asc' })
    .limit(limit)
    .build();
  return db.query(plan);
}
