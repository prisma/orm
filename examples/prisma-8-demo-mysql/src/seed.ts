import type { Db } from './prisma/db';

/**
 * Writes the demo's users and posts. The ORM cannot write to MySQL yet, so the rows go in through the raw SQL lane.
 */
export async function seed(db: Db): Promise<void> {
  const users = db.raw.sql`INSERT INTO User (id, email, role) VALUES
    (1, 'ada@example.com', 'ADMIN'),
    (2, 'bea@example.com', 'USER'),
    (3, 'cy@example.com', 'ADMIN'),
    (4, 'dot@example.com', 'ADMIN')`;
  const posts = db.raw.sql`INSERT INTO Post (id, title, authorId) VALUES
    (1, 'Hello MySQL', 1),
    (2, 'Ordered includes', 1),
    (3, 'Joins without LATERAL', 1),
    (4, 'First post', 2)`;
  await db.execute(users.affectedCount().build());
  await db.execute(posts.affectedCount().build());
}
