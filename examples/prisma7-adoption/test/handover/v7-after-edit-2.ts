/**
 * After the second Prisma 8 migration dropped `bio` and made `likes` optional:
 * the regenerated Prisma 7 client reads the surviving columns and writes a
 * null into `likes`.
 */
import { prisma } from '../../src/db';

const post = await prisma.post.findFirstOrThrow({
  orderBy: { id: 'asc' },
  include: { comments: { orderBy: { id: 'asc' } } },
});
console.log(`${post.title}: ${post.likes} likes via Prisma 7`);
for (const comment of post.comments) {
  console.log(`  comment: ${comment.body} via Prisma 7`);
}
const cleared = await prisma.post.update({ where: { id: post.id }, data: { likes: null } });
console.log(`${cleared.title}: likes cleared to ${cleared.likes} via Prisma 7`);
const bob = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } });
console.log(`${bob.email} columns: ${Object.keys(bob).sort().join(', ')}`);
await prisma.$disconnect();
