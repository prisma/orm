import type { Db } from '../prisma/db';

/** Every post with its author. */
export function getPostsWithAuthors(db: Db) {
  return db.orm.Post.include('author')
    .orderBy((p) => p.id.asc())
    .all();
}
