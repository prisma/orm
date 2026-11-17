import type { DemoOrm } from '../prisma/db';

export async function ormClientGetUsersByIdCursor(
  cursor: string | null,
  limit: number,
  orm: DemoOrm,
) {
  const orderedUsers = orm.User.orderBy((user) => user.id.asc()).select('id', 'email', 'kind');
  const scopedUsers = cursor ? orderedUsers.cursor({ id: cursor }) : orderedUsers;
  return scopedUsers.limit(limit).all();
}
