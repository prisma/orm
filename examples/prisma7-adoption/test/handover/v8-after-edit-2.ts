/**
 * After the second Prisma 8 migration made `likes` optional: Prisma 8's ORM
 * reads the null the Prisma 7 client wrote and the value it left alone.
 */
import { db, prisma } from '../../src/db';

const posts = await db.orm.public.Post.orderBy((post) => post.id.asc()).all();
for (const post of posts) {
  console.log(`${post.title}: likes ${post.likes ?? 'null'} via Prisma 8`);
}
await prisma.$disconnect();
