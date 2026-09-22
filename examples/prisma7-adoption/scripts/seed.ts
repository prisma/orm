/**
 * Seeds the database through the Prisma 7 client: the rows a Prisma 7 app
 * already has when it starts adopting Prisma 8.
 */
import { prisma } from '../src/db';

const typescript = await prisma.tag.upsert({
  where: { name: 'typescript' },
  update: {},
  create: { name: 'typescript' },
});
const orm = await prisma.tag.upsert({
  where: { name: 'orm' },
  update: {},
  create: { name: 'orm' },
});

await prisma.user.upsert({
  where: { email: 'alice@example.com' },
  update: {},
  create: {
    email: 'alice@example.com',
    name: 'Alice',
    role: 'ADMIN',
    posts: {
      create: [
        {
          title: 'Adopting Prisma 8 next to Prisma 7',
          content: 'Both clients, one database.',
          published: true,
          tags: { connect: [{ id: typescript.id }, { id: orm.id }] },
        },
        { title: 'Draft: what changes at cutover', tags: { connect: [{ id: orm.id }] } },
      ],
    },
  },
});
await prisma.user.upsert({
  where: { email: 'bob@example.com' },
  update: {},
  create: { email: 'bob@example.com', name: 'Bob' },
});

const users = await prisma.user.count();
const posts = await prisma.post.count();
console.log(`Seeded through Prisma 7: ${users} users, ${posts} posts.`);
await prisma.$disconnect();
