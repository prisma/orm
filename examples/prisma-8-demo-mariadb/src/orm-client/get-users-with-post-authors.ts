import type { Db } from '../prisma/db';

/** Every user's emails and post titles, each post with its author's email: an include two levels deep. */
export function getUsersWithPostAuthors(db: Db) {
  return db.orm.User.select('email')
    .include('posts', (posts) =>
      posts
        .select('title')
        .orderBy((p) => p.id.asc())
        .include('author', (author) => author.select('email')),
    )
    .orderBy((u) => u.id.asc())
    .all();
}
