/**
 * After the first Prisma 8 migration: the regenerated Prisma 7 client writes
 * and reads the new `bio` and `likes` columns and the new `Comment` model.
 */
import { prisma } from '../../src/db';

const bob = await prisma.user.update({
  where: { email: 'bob@example.com' },
  data: { bio: 'Written through Prisma 7' },
});
const post = await prisma.post.findFirstOrThrow({ orderBy: { id: 'asc' } });
await prisma.post.update({ where: { id: post.id }, data: { likes: { increment: 3 } } });
await prisma.comment.create({
  data: { body: 'Commented through Prisma 7', post: { connect: { id: post.id } } },
});

const read = await prisma.post.findUniqueOrThrow({
  where: { id: post.id },
  include: { comments: { orderBy: { id: 'asc' } } },
});
console.log(`${bob.email} bio: ${bob.bio} via Prisma 7`);
console.log(`${read.title}: ${read.likes} likes via Prisma 7`);
for (const comment of read.comments) {
  console.log(`  comment: ${comment.body} via Prisma 7`);
}
await prisma.$disconnect();
