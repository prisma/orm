import type { Db } from './db';

export async function seed(orm: Db['orm']) {
  const createdUsers = await orm.users.createAll([
    {
      name: 'Alice Chen',
      email: 'alice@example.com',
      bio: 'Full-stack engineer and tech blogger',
      role: 'author',
      address: { street: '123 Main St', city: 'San Francisco', zip: '94102', country: 'US' },
    },
    {
      name: 'Bob Kumar',
      email: 'bob@example.com',
      bio: 'DevOps enthusiast',
      role: 'author',
      address: { street: '456 Oak Ave', city: 'Portland', zip: null, country: 'US' },
    },
    { name: 'Carol Santos', email: 'carol@example.com', bio: null, role: 'reader', address: null },
  ]);
  const alice = createdUsers[0];
  const bob = createdUsers[1];
  const carol = createdUsers[2];
  if (!alice || !bob || !carol) throw new Error('Failed to seed users');

  const articles = orm.posts.variant('Article');
  const tutorials = orm.posts.variant('Tutorial');

  await articles.createAll([
    {
      title: 'Getting Started with Prisma 8',
      content: 'Learn how to build contract-first data access layers with Prisma 8 and MongoDB.',
      summary: 'A comprehensive introduction to contract-first data layers.',
      authorId: alice._id,
      createdAt: new Date('2026-01-15'),
    },
    {
      title: 'Contract-First Development',
      content:
        'Why contract-first architecture leads to better type safety and developer experience.',
      summary: 'The benefits of contract-first over code-first approaches.',
      authorId: alice._id,
      createdAt: new Date('2026-02-01'),
    },
  ]);

  await tutorials.createAll([
    {
      title: 'Build a REST API with Prisma 8',
      content: 'Step-by-step tutorial for building a REST API with Prisma 8 and MongoDB.',
      difficulty: 'intermediate',
      duration: 45,
      authorId: bob._id,
      createdAt: new Date('2026-02-20'),
    },
    {
      title: 'Advanced Query Patterns',
      content: 'Deep dive into advanced query patterns for MongoDB.',
      difficulty: 'advanced',
      duration: 90,
      authorId: carol._id,
      createdAt: new Date('2026-03-10'),
    },
  ]);
}
