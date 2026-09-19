import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { NotFoundError } from '../errors';
import { sql } from '../prisma-no-emit/context';

const demoPostId = '00000000-feed-0000-0000-000000000001';
const demoUserId = '00000000-feed-0000-0000-000000000002';

/**
 * Demonstrates that `Post.priority` is typed-optional in an insert when the
 * field carries `.default(Priority.members.Low)` in the inline TS contract —
 * omitting it lets the database supply 0, which we verify by reading back.
 */
export async function enumDefaultDemoNoEmit(runtime: Runtime): Promise<void> {
  await runtime.execute(
    sql.user.insert([{ id: demoUserId, email: 'demo@example.com', kind: 'user' }]).build(),
  );

  // `priority` is intentionally omitted — the field is typed-optional here
  // because the TS contract declares `.default(Priority.members.Low)`.
  await runtime.execute(
    sql.post.insert([{ id: demoPostId, title: 'Enum-default demo', userId: demoUserId }]).build(),
  );

  const rows = await runtime.query(
    sql.post
      .select('id', 'priority')
      .where((f, fns) => fns.eq(f.id, demoPostId))
      .build(),
  );
  const row = rows[0];
  if (!row) throw new NotFoundError('Demo post not found after insert');

  console.log(`priority read back from DB: ${row.priority}`);
  console.log(`Expected 0 (the .default(Priority.members.Low) value): ${row.priority === 0}`);

  await runtime.execute(
    sql.post
      .delete()
      .where((f, fns) => fns.eq(f.id, demoPostId))
      .build(),
  );
  await runtime.execute(
    sql.user
      .delete()
      .where((f, fns) => fns.eq(f.id, demoUserId))
      .build(),
  );
}
