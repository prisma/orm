import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

/**
 * Bug triage view: each user with only their `Bug` tasks of a given severity.
 *
 * `.variant('Bug')` narrows the polymorphic include to a single variant, so the
 * included rows are `Bug`-shaped and the refinement's `where` can filter on the
 * variant's own column (`severity`, which lives in the joined `bug` table). The
 * include takes the default projection, so each row comes back in its full
 * `Bug` shape — the shared `Task` columns plus the `Bug` columns.
 */
export async function ormClientGetUserBugTriage(severity: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.select('id', 'displayName')
    .include('tasks', (tasks) =>
      tasks
        .variant('Bug')
        .where((bug) => bug.severity.eq(severity))
        .orderBy((bug) => bug.createdAt.asc()),
    )
    .orderBy((user) => user.displayName.asc())
    .limit(limit)
    .all();
}
