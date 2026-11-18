/**
 * After the first Prisma 8 migration: Prisma 8's ORM reads the rows the
 * Prisma 7 client wrote into the new columns and the new `Comment` table.
 */
import { db, prisma } from '../../src/db';

const users = await db.orm.public.User.orderBy((user) => user.id.asc()).all();
for (const user of users) {
  console.log(`${user.email} bio: ${user.bio ?? '(none)'} via Prisma 8`);
}
const comments = await db.orm.public.Comment.include('post')
  .orderBy((comment) => comment.id.asc())
  .all();
for (const comment of comments) {
  console.log(
    `${comment.post.title}: ${comment.post.likes} likes, comment: ${comment.body} via Prisma 8`,
  );
}
await prisma.$disconnect();
