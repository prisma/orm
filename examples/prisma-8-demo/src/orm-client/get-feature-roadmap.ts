import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

/**
 * Release roadmap: each user with the `Feature` tasks slated for one release.
 *
 * The mirror image of the bug-triage view, narrowed to the other variant.
 * `Feature` is a multi-table-inheritance variant — `priority` / `targetRelease`
 * live in a separate `feature` table — so filtering on `targetRelease` exercises
 * a `where` against a column reached through the variant join inside the
 * correlated include sub-select.
 */
export async function ormClientGetFeatureRoadmap(
  targetRelease: string,
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.User.select('id', 'displayName')
    .include('tasks', (tasks) =>
      tasks
        .variant('Feature')
        .where((feature) => feature.targetRelease.eq(targetRelease))
        .orderBy((feature) => feature.createdAt.asc()),
    )
    .orderBy((user) => user.displayName.asc())
    .limit(limit)
    .all();
}
