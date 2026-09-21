import { NotFoundError } from '../errors';
import { db } from '../prisma/db';

const demoPostId = '00000000-feed-0000-0000-000000000001';
const demoUserId = '00000000-feed-0000-0000-000000000002';

/**
 * Demonstrates that `Post.priority` is typed-optional in an insert when the
 * field carries `@default(Low)` in the emitted contract — omitting it lets the
 * database supply 0, which we verify by reading the row back.
 */
export async function enumDefaultDemo(): Promise<void> {
  await db
    .runtime()
    .execute(
      db.sql.public.user
        .insert([{ id: demoUserId, email: 'demo@example.com', displayName: 'Demo', kind: 'user' }])
        .build(),
    );

  // `priority` is intentionally omitted — the field is typed-optional here
  // because the emitted contract records its `@default(Low)` member default.
  await db
    .runtime()
    .execute(
      db.sql.public.post
        .insert([{ id: demoPostId, title: 'Enum-default demo', userId: demoUserId }])
        .build(),
    );

  const rows = await db.runtime().query(
    db.sql.public.post
      .select('id', 'priority')
      .where((f, fns) => fns.eq(f.id, demoPostId))
      .build(),
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('Demo post not found after insert');

  console.log(`priority read back from DB: ${row.priority}`);
  console.log(`Expected 0 (the @default(Low) member value): ${row.priority === 0}`);

  await db.runtime().execute(
    db.sql.public.post
      .delete()
      .where((f, fns) => fns.eq(f.id, demoPostId))
      .build(),
  );
  await db.runtime().execute(
    db.sql.public.user
      .delete()
      .where((f, fns) => fns.eq(f.id, demoUserId))
      .build(),
  );
}
