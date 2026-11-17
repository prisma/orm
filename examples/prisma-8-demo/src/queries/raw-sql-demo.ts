import { db } from '../prisma/db';

/**
 * Three uses of `fns.raw` in one query — when stock builder operators don't
 * cover the SQL you need, drop down to a raw fragment without leaving the
 * typed builder:
 *
 * 1. **Projection** — `select('upper_email', (f, fns) => fns.raw\`UPPER(${f.email})\`.returns('pg/text@1'))`.
 *    The aliased column is added to the row type with the codec id declared
 *    on `.returns()`.
 *
 * 2. **Filter** — `where((f, fns) => fns.raw\`LENGTH(${f.email}) > 10\`.returns('pg/bool@1'))`.
 *    The raw expression participates in the `WHERE` predicate alongside
 *    the stock `fns.eq` / `fns.gt` family.
 *
 * 3. **Typed-expression interpolation** — `${fns.eq(f.kind, 'admin')}` inside
 *    the template literal lowers to the operator's `BinaryExpr` AST node
 *    (not a string splice). The interpolated value can be any
 *    `Expression<…>` — bare field reference (`f.email`), aggregate result
 *    (`fns.count(f.id)`), nested raw, builder-operation output — all carry
 *    their AST + codec through the raw renderer unchanged.
 */
export async function rawSqlDemo(limit = 10) {
  const plan = db.sql.public.user
    .select('id', 'email')
    .select('upperEmail', (f, fns) => fns.raw`UPPER(${f.email})`.returns('pg/text@1'))
    .select('kindLabel', (f, fns) =>
      fns.raw`CASE WHEN ${fns.eq(f.kind, 'admin')} THEN 'admin' ELSE 'regular user' END`.returns(
        'pg/text@1',
      ),
    )
    .where((f, fns) => fns.gt(fns.raw`LENGTH(${f.email})`.returns('pg/int4@1'), 10))
    .orderBy('email')
    .limit(limit)
    .build();
  return await db.query(plan);
}
