import type { DemoOrm } from '../prisma/db';

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
  orm: DemoOrm,
) {
  return orm.User.select('id', 'displayName')
    .include('tasks', (tasks) =>
      tasks
        .variant('feature')
        .where((feature) => feature.targetRelease.eq(targetRelease))
        .orderBy((feature) => feature.createdAt.asc()),
    )
    .orderBy((user) => user.displayName.asc())
    .limit(limit)
    .all();
}
