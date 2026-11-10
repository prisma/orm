/**
 * After the second Prisma 8 migration dropped `bio` and made `likes` optional:
 * the regenerated Prisma 7 client reads the surviving columns, writes a null
 * into `likes`, and sets a `viewCount` the next edit's sequence must start past.
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
const cleared = await prisma.post.update({
  where: { id: post.id },
  data: { likes: null, viewCount: 41 },
});
console.log(`${cleared.title}: likes cleared to ${cleared.likes} via Prisma 7`);
console.log(`${cleared.title}: viewCount set to ${cleared.viewCount} via Prisma 7`);
const bob = await prisma.user.findUniqueOrThrow({ where: { email: 'bob@example.com' } });
console.log(`${bob.email} columns: ${Object.keys(bob).sort().join(', ')}`);
await prisma.$disconnect();
