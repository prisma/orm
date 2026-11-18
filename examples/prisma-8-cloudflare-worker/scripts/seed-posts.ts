import type { Client } from 'pg';

/**
 * Enough posts for the `/cursor/large` route to stream and break early. Sized to the post-table
 * budget in `src/prisma/db.ts`.
 */
export const GENERATED_POST_COUNT = 10_000;

/**
 * Inserts `count` generated posts, alternating between the two users, in one statement.
 */
export async function insertGeneratedPosts(
  client: Client,
  userIds: readonly [string, string],
  count: number,
): Promise<void> {
  await client.query(
    `INSERT INTO "post" (id, title, "userId", "createdAt")
     SELECT
       '10000000-0000-4000-8000-' || lpad(g::text, 12, '0'),
       'Post ' || g,
       CASE WHEN g % 2 = 0 THEN $1 ELSE $2 END,
       TIMESTAMPTZ '2026-04-01 00:00:00+00' + ((g % 365) * INTERVAL '1 hour')
     FROM generate_series(1, $3::int) AS g`,
    [userIds[0], userIds[1], count],
  );
}
