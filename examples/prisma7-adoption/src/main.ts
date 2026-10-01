/**
 * The routes that moved to Prisma 8: the same rows Prisma 7 wrote, read and
 * written through `db.orm.public.<Model>`, with the tags reached through the
 * `_PostToTag` junction Prisma 7 created, and `updatedAt` set by Prisma 8's own
 * generator on update.
 */
import { db, prisma } from './db';

const users = await db.orm.public.User.include('posts', (posts) =>
  posts
    .include('tags', (tags) => tags.orderBy((tag) => tag.name.asc()))
    .orderBy((post) => post.id.asc()),
)
  .orderBy((user) => user.id.asc())
  .all();
for (const user of users) {
  console.log(`${user.name ?? user.email} (${user.role}) via Prisma 8`);
  for (const post of user.posts) {
    console.log(`  - ${post.title} [${post.tags.map((tag) => tag.name).join(', ')}]`);
  }
}

const alice = users.find((user) => user.email === 'alice@example.com');
const ormTag = await db.orm.public.Tag.where({ name: 'orm' }).first();
if (alice === undefined || ormTag === null) {
  console.error('Run `pnpm seed` first.');
  process.exit(1);
}

const created = await db.orm.public.Post.include('tags').create({
  title: `Written through Prisma 8 at ${new Date().toISOString()}`,
  authorId: alice.id,
  tags: (tags) => tags.connect([{ id: ormTag.id }]),
});
console.log(
  `Created post ${created.id} through Prisma 8, tagged ${created.tags.map((tag) => tag.name).join(', ')}`,
);

const renamed = await db.orm.public.User.where({ id: alice.id }).update({
  name: `Alice (renamed by Prisma 8 at ${new Date().toISOString()})`,
});
console.log(
  `updatedAt advanced: ${alice.updatedAt.toString()} -> ${renamed?.updatedAt.toString()}`,
);

await prisma.$disconnect();
