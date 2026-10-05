/**
 * After the third Prisma 8 migration gave `viewCount` an autoincrement
 * default: the regenerated Prisma 7 client creates a post without a
 * `viewCount`, and the sequence fills in one past the largest existing value.
 */
import { prisma } from '../../src/db';

const largest = await prisma.post.aggregate({ _max: { viewCount: true } });
const alice = await prisma.user.findUniqueOrThrow({ where: { email: 'alice@example.com' } });
const created = await prisma.post.create({
  data: { title: 'Numbered by the sequence', authorId: alice.id },
});
console.log(`largest viewCount before: ${largest._max.viewCount}`);
console.log(`${created.title}: viewCount ${created.viewCount} via Prisma 7`);
await prisma.$disconnect();
