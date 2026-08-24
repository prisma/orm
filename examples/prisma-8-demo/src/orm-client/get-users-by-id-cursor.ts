import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUsersByIdCursor(
  cursor: string | null,
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  const orderedUsers = db.User.orderBy((user) => user.id.asc()).select('id', 'email', 'kind');
  const scopedUsers = cursor ? orderedUsers.cursor({ id: cursor }) : orderedUsers;
  return scopedUsers.limit(limit).all();
}
