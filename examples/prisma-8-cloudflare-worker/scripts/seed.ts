/**
 * Seeds the demo schema with users, posts, and tasks.
 *
 * Mirrors examples/prisma-8-demo/scripts/seed.ts minus the pgvector
 * embeddings (this example exercises the serverless client and its connections, not vectors).
 */

import 'temporal-polyfill/full/global';
import { Client } from 'pg';
import { postgres } from '../src/prisma/db';
import { EXAMPLE_ROOT, HYPERDRIVE_VAR, loadLocalEnv } from './env';
import { GENERATED_POST_COUNT, insertGeneratedPosts } from './seed-posts';

const firstPostDay = Temporal.PlainDate.from('2026-04-10');

async function main() {
  loadLocalEnv(EXAMPLE_ROOT);
  const url = process.env[HYPERDRIVE_VAR] ?? process.env['DATABASE_URL'];

  if (!url) {
    throw new Error(`Set ${HYPERDRIVE_VAR} in .env (or DATABASE_URL) before running pnpm seed.`);
  }

  const bulk = new Client({ connectionString: url });
  await bulk.connect();
  try {
    await seed(bulk, url);
  } finally {
    await bulk.end();
  }
}

async function seed(bulk: Client, url: string) {
  await using db = await postgres.connect({ url });

  await bulk.query('TRUNCATE "post", "task", "user" RESTART IDENTITY CASCADE');

  await db.runtime().execute(
    db.sql.public.user
      .insert([
        {
          email: 'alice@example.com',
          displayName: 'Alice',
          createdAt: Temporal.Instant.from('2026-04-01T00:00:00.000Z'),
          kind: 'admin',
          address: { street: '123 Main St', city: 'San Francisco', zip: '94102', country: 'US' },
        },
      ])
      .build(),
  );

  await db.runtime().execute(
    db.sql.public.user
      .insert([
        {
          email: 'bob@example.com',
          displayName: 'Bob',
          createdAt: Temporal.Instant.from('2026-04-02T00:00:00.000Z'),
          kind: 'user',
          address: { street: '456 Oak Ave', city: 'Portland', zip: null, country: 'US' },
        },
      ])
      .build(),
  );

  const aliceRows = await db.runtime().query(
    db.sql.public.user
      .select('id', 'email')
      .where((f, fns) => fns.eq(f.email, 'alice@example.com'))
      .limit(1)
      .build(),
  );
  const bobRows = await db.runtime().query(
    db.sql.public.user
      .select('id', 'email')
      .where((f, fns) => fns.eq(f.email, 'bob@example.com'))
      .limit(1)
      .build(),
  );
  const alice = aliceRows[0];
  const bob = bobRows[0];
  if (!alice || !bob) {
    throw new Error('Failed to find seeded users');
  }

  for (let i = 0; i < 5; i++) {
    await db.runtime().execute(
      db.sql.public.post
        .insert([
          {
            title: `Alice post ${i + 1}`,
            userId: alice.id,
            createdAt: firstPostDay.add({ days: i }).toZonedDateTime('UTC').toInstant(),
          },
        ])
        .build(),
    );
  }

  for (let i = 0; i < 3; i++) {
    await db.runtime().execute(
      db.sql.public.post
        .insert([
          {
            title: `Bob post ${i + 1}`,
            userId: bob.id,
            createdAt: firstPostDay
              .add({ days: 10 + i })
              .toZonedDateTime('UTC')
              .toInstant(),
          },
        ])
        .build(),
    );
  }

  await insertGeneratedPosts(bulk, [alice.id, bob.id], GENERATED_POST_COUNT);

  console.log(`Seeded users: alice=${alice.id}, bob=${bob.id}`);
  console.log(
    `Seeded 8 posts of theirs plus ${GENERATED_POST_COUNT} generated posts for /cursor/large (tasks/bugs/features intentionally empty — exercised by tests). Running seed again starts from empty tables.`,
  );
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
