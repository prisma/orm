/**
 * Database Seed Script
 *
 * Populates the demo database with sample data using Prisma Next's SQL builder.
 *
 * Run with: pnpm seed
 *
 * Creates:
 * - 2 users (alice, bob)
 * - 3 posts with vector embeddings (for similarity search demos) and
 *   engagement counters (for the integer-representation demos)
 * - 3 tags (typescript, orm, demo) + post_tag junction rows (for the
 *   many-to-many demos)
 *
 * Prerequisites:
 * - DATABASE_URL environment variable set
 * - Database schema and marker applied (run `pnpm emit` then `pnpm db:init`)
 */
import 'dotenv/config';

import { loadAppConfig } from '../src/app-config';
import { createOrmClient } from '../src/orm-client/client';
// Node ships no global `Temporal`, and this script writes Temporal-backed columns.
// `full/global` rather than `global`: the default build omits non-ISO calendars and its
// published types resolve to `export {}`.
import 'temporal-polyfill/full/global';
import { db } from '../src/prisma/db';

async function main() {
  const { databaseUrl } = loadAppConfig();
  const runtime = await db.connect({ url: databaseUrl });

  try {
    // Insert users with embedded address value objects
    await runtime.execute(
      db.sql.public.user
        .insert([
          {
            email: 'alice@example.com',
            displayName: 'Alice',
            createdAt: Temporal.Now.instant(),
            kind: 'admin',
            address: { street: '123 Main St', city: 'San Francisco', zip: '94102', country: 'US' },
          },
        ])
        .build(),
    );

    await runtime.execute(
      db.sql.public.user
        .insert([
          {
            email: 'bob@example.com',
            displayName: 'Bob',
            createdAt: Temporal.Now.instant(),
            kind: 'user',
            address: { street: '456 Oak Ave', city: 'Portland', zip: null, country: 'US' },
          },
        ])
        .build(),
    );

    const aliceRows = await runtime.query(
      db.sql.public.user
        .select('id', 'email')
        .where((f, fns) => fns.eq(f.email, 'alice@example.com'))
        .limit(1)
        .build(),
    );
    const alice = aliceRows[0] ?? null;

    const bobRows = await runtime.query(
      db.sql.public.user
        .select('id', 'email')
        .where((f, fns) => fns.eq(f.email, 'bob@example.com'))
        .limit(1)
        .build(),
    );
    const bob = bobRows[0] ?? null;

    if (!alice || !bob) {
      throw new Error('Failed to create users');
    }

    console.log(`Created user: ${alice.email} (id: ${alice.id})`);
    console.log(`Created user: ${bob.email} (id: ${bob.id})`);

    // Generate sample embedding vectors (1536 dimensions, matching common embedding models)
    const generateEmbedding = (seed: number): number[] => {
      const embedding: number[] = [];
      for (let i = 0; i < 1536; i++) {
        embedding.push(Math.sin(seed + i) * 0.1);
      }
      return embedding;
    };

    // Insert posts with embeddings and engagement counters.
    //
    // The counters are chosen so the integer-representation demos have
    // something to say (`integer-representations`, `aggregate-precision`):
    //
    // - viewCount is `BigIntNumber`, a JS `number`. Every row and the total
    //   stay inside ±(2^53 − 1), so `sum('viewCount')` answers normally.
    // - impressionCount is `BigInt`, a `bigint`. No single row crosses the
    //   safe-integer range — 2^52 twice and a thousand — but their total is
    //   2^53 + 1000. That is what makes `sum('impressionCount')` throw and
    //   `sumBigInt('impressionCount')` answer: the guard is about the value
    //   the aggregate produces, not about the values it read.
    // - reachScore is `UnboundedInt`, exact at any magnitude. Two rows sit
    //   past 2^63 — where a 64-bit column would already have overflowed —
    //   and one is small, because the same column holds ordinary values too.
    const firstPostRows = await runtime.query(
      db.sql.public.post
        .insert([
          {
            title: 'First Post',
            userId: alice.id,
            priority: db.enums.public.Priority.members.Low,
            embedding: generateEmbedding(1),
            createdAt: Temporal.Now.instant(),
            viewCount: 12_500,
            impressionCount: 4_503_599_627_370_496n,
            reachScore: 18_446_744_073_709_551_616n,
          },
        ])
        .returning('id', 'title')
        .build(),
    );

    const secondPostRows = await runtime.query(
      db.sql.public.post
        .insert([
          {
            title: 'Second Post',
            userId: alice.id,
            priority: db.enums.public.Priority.members.High,
            embedding: generateEmbedding(2),
            createdAt: Temporal.Now.instant(),
            viewCount: 9_800,
            impressionCount: 4_503_599_627_370_496n,
            reachScore: 9_223_372_036_854_775_809n,
          },
        ])
        .returning('id', 'title')
        .build(),
    );

    await runtime.execute(
      db.sql.public.post
        .insert([
          {
            title: 'Third Post',
            userId: bob.id,
            priority: db.enums.public.Priority.members.Urgent,
            embedding: generateEmbedding(3),
            createdAt: Temporal.Now.instant(),
            viewCount: 3_112,
            impressionCount: 1_000n,
            reachScore: 42n,
          },
        ])
        .build(),
    );

    const firstPost = firstPostRows[0] ?? null;
    const secondPost = secondPostRows[0] ?? null;
    if (!firstPost || !secondPost) {
      throw new Error('Failed to create posts');
    }

    console.log(`Created post: ${firstPost.title} (id: ${firstPost.id})`);
    console.log(`Created post: ${secondPost.title} (id: ${secondPost.id})`);

    // Insert tags + junction rows powering the many-to-many demos
    // (repo-post-tags, repo-tag-posts, repo-posts-with-tag-*, the nested
    // connect/disconnect/create commands). The third post stays untagged so
    // the `every` filter's vacuous-truth semantics are observable.
    const tagTypeScriptRows = await runtime.query(
      db.sql.public.tag
        .insert([{ label: 'typescript' }])
        .returning('id', 'label')
        .build(),
    );
    const tagOrmRows = await runtime.query(
      db.sql.public.tag
        .insert([{ label: 'orm' }])
        .returning('id', 'label')
        .build(),
    );
    const tagDemoRows = await runtime.query(
      db.sql.public.tag
        .insert([{ label: 'demo' }])
        .returning('id', 'label')
        .build(),
    );

    const tagTypeScript = tagTypeScriptRows[0] ?? null;
    const tagOrm = tagOrmRows[0] ?? null;
    const tagDemo = tagDemoRows[0] ?? null;
    if (!tagTypeScript || !tagOrm || !tagDemo) {
      throw new Error('Failed to create tags');
    }

    console.log(`Created tag: ${tagTypeScript.label} (id: ${tagTypeScript.id})`);
    console.log(`Created tag: ${tagOrm.label} (id: ${tagOrm.id})`);
    console.log(`Created tag: ${tagDemo.label} (id: ${tagDemo.id})`);

    await runtime.execute(
      db.sql.public.post_tag
        .insert([
          { postId: firstPost.id, tagId: tagTypeScript.id },
          { postId: firstPost.id, tagId: tagOrm.id },
          { postId: secondPost.id, tagId: tagOrm.id },
          { postId: secondPost.id, tagId: tagDemo.id },
        ])
        .build(),
    );

    console.log('Seeded post_tag junction rows.');

    // Insert polymorphic tasks. `Task` is a discriminated base (`@@discriminator(type)`)
    // with `Bug` / `Feature` variants stored in their own tables. The ORM client's
    // variant scopes (`Task.bugs()` / `Task.features()`) auto-inject the discriminator
    // and, for the multi-table `Feature` variant, write the base + variant rows in one
    // transaction. These rows power the polymorphic-include demos (`repo-task-board`,
    // `repo-bug-triage`, `repo-feature-roadmap`).
    const orm = createOrmClient(runtime);

    await orm.Task.bugs().create({
      title: 'Login crashes on Safari',
      userId: alice.id,
      severity: 'critical',
      stepsToRepro: 'Open Safari → click "Sign in" → blank white screen',
      createdAt: Temporal.Instant.from('2024-03-01T09:00:00.000Z'),
    });
    await orm.Task.features().create({
      title: 'Dark mode',
      userId: alice.id,
      priority: 'P1',
      targetRelease: 'v2.0',
      createdAt: Temporal.Instant.from('2024-03-02T09:00:00.000Z'),
    });
    await orm.Task.features().create({
      title: 'CSV export',
      userId: alice.id,
      priority: 'P2',
      createdAt: Temporal.Instant.from('2024-03-03T09:00:00.000Z'),
    });

    await orm.Task.bugs().create({
      title: 'Memory leak in import worker',
      userId: bob.id,
      severity: 'critical',
      stepsToRepro: 'Import 1M rows → RSS climbs without bound',
      createdAt: Temporal.Instant.from('2024-03-04T09:00:00.000Z'),
    });
    await orm.Task.bugs().create({
      title: 'Typo on pricing page',
      userId: bob.id,
      severity: 'low',
      createdAt: Temporal.Instant.from('2024-03-05T09:00:00.000Z'),
    });
    await orm.Task.features().create({
      title: 'Slack integration',
      userId: bob.id,
      priority: 'P0',
      targetRelease: 'v2.0',
      createdAt: Temporal.Instant.from('2024-03-06T09:00:00.000Z'),
    });

    console.log('Created 6 polymorphic tasks (3 bugs, 3 features) across Alice and Bob');

    console.log('Seed completed successfully!');
  } finally {
    await runtime.close();
  }
}

main().catch((e) => {
  console.error('Error seeding database:', e);
  process.exitCode = 1;
});
