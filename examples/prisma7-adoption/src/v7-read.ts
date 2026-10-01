/**
 * Reads the rows through the Prisma 7 client. Routes that have not moved yet
 * keep running exactly like this while Prisma 8 serves the others.
 */
import { prisma } from './db';

const users = await prisma.user.findMany({
  orderBy: { id: 'asc' },
  include: { posts: { orderBy: { id: 'asc' }, include: { tags: { orderBy: { name: 'asc' } } } } },
});
for (const user of users) {
  console.log(`${user.name ?? user.email} (${user.role}) via Prisma 7`);
  for (const post of user.posts) {
    console.log(`  - ${post.title} [${post.tags.map((tag) => tag.name).join(', ')}]`);
  }
}
await prisma.$disconnect();
