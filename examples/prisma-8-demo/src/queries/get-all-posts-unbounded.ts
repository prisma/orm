import { db } from '../prisma/db';

/**
 * WARNING: This query intentionally violates the row budget to demonstrate
 * budget enforcement. It selects all posts without a LIMIT clause, which
 * will trigger a BUDGET.ROWS_EXCEEDED error when the estimated row count
 * exceeds the budget (default: 10,000 rows).
 *
 * This demonstrates the budget workflow:
 * 1. Budget middleware checks the query before execution
 * 2. Detects unbounded SELECT (no LIMIT)
 * 3. Throws BUDGET.ROWS_EXCEEDED error
 * 4. Query execution is blocked
 *
 * To fix this query, add a .limit() clause or add proper filtering.
 */
export async function getAllPostsUnbounded() {
  const plan = db.sql.public.post.select('id', 'title', 'userId', 'createdAt').build();
  return db.query(plan);
}
