import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { db } from '../prisma/db';

/**
 * Whole-query raw SQL — the statement-position counterpart to `fns.raw`
 * (see `raw-sql-demo.ts`, which drops raw *fragments* into a typed builder
 * query).
 *
 * `db.raw` is the client's raw lane, composed beside `sql` and `runtime()`.
 * Its `sql` key is the same tagged template as `fns.raw`, with different
 * terminators:
 *
 * - `.returnsRow(spec)` declares the result columns and yields a plan the
 *   runtime's `query()` streams decoded rows from.
 * - `.affectedCount()` declares no columns and yields a plan the runtime's
 *   `execute()` reports statistics for.
 *
 * A row spec entry is either a contract column (`user.columns.email` — codec,
 * nullability, and TypeScript type all inherited) or an explicit codec id for
 * a column the contract doesn't have, like a `count(*)`. Interpolated values
 * become bound parameters; nothing is spliced into the SQL text.
 */

const user = db.sql.public.user;
const post = db.sql.public.post;

/**
 * Read with a hybrid row spec: two contract columns and one computed column.
 *
 * `id` and `email` inherit their types from the contract, so `row.email` is a
 * `string`. `postCount` has no contract column behind it, so it declares its
 * codec directly and reads back as a `bigint`.
 */
export async function rawQueryReport(limit = 10, runtime?: Runtime) {
  const plan = db.raw.sql`
    SELECT u.id, u.email, count(p.id) AS "postCount"
    FROM "user" u
    LEFT JOIN "post" p ON p."userId" = u.id
    GROUP BY u.id, u.email
    ORDER BY count(p.id) DESC, u.email ASC
    LIMIT ${limit}
  `
    .returnsRow({
      id: user.columns.id,
      email: user.columns.email,
      postCount: 'pg/int8@1',
    })
    .build();

  return (runtime ?? db.runtime()).query(plan);
}

/**
 * Mutation reporting how many rows it touched.
 *
 * `.affectedCount()` takes no row spec — the statement returns no rows, so
 * there is nothing to declare. The plan goes to the runtime's `execute()`,
 * which answers with the statement's row count rather than a row stream.
 */
export async function rawQueryBumpViews(kind = 'admin', runtime?: Runtime) {
  const plan = db.raw.sql`
    UPDATE "post"
    SET "viewCount" = "viewCount" + 1
    WHERE "userId" IN (SELECT id FROM "user" WHERE kind = ${kind})
  `
    .affectedCount()
    .build();

  return (runtime ?? db.runtime()).execute(plan);
}

/**
 * A CTE assembled by interpolating one raw query into another.
 *
 * A row-returning raw query is embeddable: interpolating it splices its SQL
 * and its parameters into the outer template, in order. The inner row spec
 * describes the inner statement, and the outer template declares its own.
 *
 * A column the inner query already declared can be inherited from its
 * `.returns` record instead of restating the codec id. That keeps the two
 * declarations from drifting apart.
 */
export async function rawQueryActiveAuthors(minPosts = 1, runtime?: Runtime) {
  const authorsWithPosts = db.raw.sql`
    SELECT p."userId" AS "userId", count(*) AS "postCount"
    FROM "post" p
    GROUP BY p."userId"
    HAVING count(*) >= ${minPosts}
  `.returnsRow({
    userId: post.columns.userId,
    postCount: 'pg/int8@1',
  });

  const plan = db.raw.sql`
    WITH active AS (${authorsWithPosts})
    SELECT u.email, active."postCount"
    FROM active
    JOIN "user" u ON u.id = active."userId"
    ORDER BY active."postCount" DESC, u.email ASC
  `
    .returnsRow({
      email: user.columns.email,
      postCount: authorsWithPosts.returns.postCount,
    })
    .build();

  return (runtime ?? db.runtime()).query(plan);
}

/**
 * A data-modifying CTE: an `UPDATE … RETURNING` composed into an outer query.
 *
 * This is why embeddability is tied to row-returning statements rather than to
 * statement kind. A mutation with `RETURNING` produces rows, so it takes a row
 * spec and composes like any other; a mutation without one is a plan handle
 * and is rejected as an interpolation.
 */
export async function rawQueryPromoteAndList(titleTerm: string, runtime?: Runtime) {
  const promoted = db.raw.sql`
    UPDATE "post"
    SET priority = ${db.enums.public.Priority.members.High}
    WHERE title ILIKE ${`%${titleTerm}%`} AND priority <> ${db.enums.public.Priority.members.High}
    RETURNING id, title, "userId"
  `.returnsRow({
    id: post.columns.id,
    title: post.columns.title,
    userId: post.columns.userId,
  });

  const plan = db.raw.sql`
    WITH promoted AS (${promoted})
    SELECT promoted.title, u.email
    FROM promoted
    JOIN "user" u ON u.id = promoted."userId"
    ORDER BY promoted.title ASC
  `
    .returnsRow({
      title: post.columns.title,
      email: user.columns.email,
    })
    .build();

  return (runtime ?? db.runtime()).query(plan);
}
