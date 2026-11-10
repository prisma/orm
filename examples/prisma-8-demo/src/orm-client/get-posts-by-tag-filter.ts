import type { DemoOrm } from '../prisma/db';

/**
 * Many-to-many filter example: list posts using relation filter predicates
 * on the N:M `tags` relation. Demonstrates `.some()`, `.none()`, and
 * `.every()` applied to a M:N relation. The `every` mode uses `label.neq(label)`
 * and follows vacuous truth semantics, so posts with no tags are included.
 *
 * @param mode  'some' | 'none' | 'every' — which predicate to apply
 * @param label Tag label to match (for some/none) or differ from (for every)
 */
export async function ormClientGetPostsByTagFilter(
  mode: 'some' | 'none' | 'every',
  label: string,
  orm: DemoOrm,
) {
  const posts = orm.Post.select('id', 'title').orderBy((p) => p.title.asc());

  if (mode === 'some') {
    return posts.where((p) => p.tags.some((t) => t.label.eq(label))).all();
  }

  if (mode === 'none') {
    return posts.where((p) => p.tags.none((t) => t.label.eq(label))).all();
  }

  return posts.where((p) => p.tags.every((t) => t.label.neq(label))).all();
}
