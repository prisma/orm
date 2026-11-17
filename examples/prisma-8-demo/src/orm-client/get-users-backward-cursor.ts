import type { DemoOrm } from '../prisma/db';

export async function ormClientGetUsersBackwardCursor(cursor: string, limit: number, orm: DemoOrm) {
  return orm.User.orderBy((user) => user.id.desc())
    .cursor({ id: cursor })
    .select('id', 'email', 'kind')
    .limit(limit)
    .all();
}
