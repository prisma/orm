import type { Db } from './prisma/db';

/** Writes the demo's users and posts through the ORM. */
export async function seed(db: Db): Promise<void> {
  await db.orm.User.createAndCount([
    { id: 1, email: 'ada@example.com', role: 'ADMIN' },
    { id: 2, email: 'bea@example.com', role: 'USER' },
    { id: 3, email: 'cy@example.com', role: 'ADMIN' },
    { id: 4, email: 'dot@example.com', role: 'ADMIN' },
  ]);
  await db.orm.Post.createAndCount([
    { id: 1, title: 'Hello MySQL', authorId: 1 },
    { id: 2, title: 'Ordered includes', authorId: 1 },
    { id: 3, title: 'Joins without LATERAL', authorId: 1 },
    { id: 4, title: 'First post', authorId: 2 },
  ]);
}
