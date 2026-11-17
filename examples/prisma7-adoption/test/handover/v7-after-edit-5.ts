/**
 * After the fifth Prisma 8 migration made deleting a post delete its comments: the regenerated Prisma 7 client deletes the post that has a comment, and the comment goes with it.
 */
import { prisma } from '../../src/db';

const post = await prisma.post.findFirstOrThrow({
  where: { comments: { some: {} } },
  include: { _count: { select: { comments: true } } },
});
await prisma.post.delete({ where: { id: post.id } });
const left = await prisma.comment.count({ where: { postId: post.id } });
console.log(
  `${post.title}: deleted with ${post._count.comments} comments, ${left} left via Prisma 7`,
);
await prisma.$disconnect();
