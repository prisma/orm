import type { Db } from '../prisma/db';

/** A user with their posts, newest title first: the posts come back in the order the include asks for. */
export function getUserWithPosts(db: Db, id: number) {
  return db.orm.User.include('posts', (posts) => posts.orderBy((p) => p.title.desc())).first({
    id,
  });
}
