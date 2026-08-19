/**
 * Seeds the demo schema with users, posts, and tasks.
 *
 * Mirrors examples/prisma-8-demo/scripts/seed.ts minus the pgvector
 * embeddings (this example exercises the per-request facade, not vectors).
 */

// Node ships no global `Temporal`, and this script writes Temporal-backed columns.
// `full/global` rather than `global`: the default build omits non-ISO calendars and its
// published types resolve to `export {}`.
import 'temporal-polyfill/full/global';
import { db } from '../src/prisma/db';
import { EXAMPLE_ROOT, HYPERDRIVE_VAR, loadLocalEnv } from './env';

// A `timestamptz` column takes a `Temporal.Instant`. Day arithmetic belongs on a `PlainDate`,
// which is then anchored to a zone to get one — no `Date` in the chain at any point.
const firstPostDay = Temporal.PlainDate.from('2026-04-10');

async function main() {
  loadLocalEnv(EXAMPLE_ROOT);
  const url = process.env[HYPERDRIVE_VAR] ?? process.env['DATABASE_URL'];

  if (!url) {
    throw new Error(`Set ${HYPERDRIVE_VAR} in .env (or DATABASE_URL) before running pnpm seed.`);
  }

  await using runtime = await db.connect({ url });

  await runtime.execute(
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

  await runtime.execute(
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

  const aliceRows = await runtime.query(
    db.sql.public.user
      .select('id', 'email')
      .where((f, fns) => fns.eq(f.email, 'alice@example.com'))
      .limit(1)
      .build(),
  );
  const bobRows = await runtime.query(
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
    await runtime.execute(
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
    await runtime.execute(
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

  console.log(`Seeded users: alice=${alice.id}, bob=${bob.id}`);
  console.log('Seed complete (tasks/bugs/features intentionally empty — exercised by tests).');
}

main().catch((err) => {
  console.error('Seed failed:', err);
  process.exitCode = 1;
});
