import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUsersBackwardCursor(
  cursor: string,
  limit: number,
  runtime: Runtime,
) {
  const db = createOrmClient(runtime);
  return db.User.orderBy((user) => user.id.desc())
    .cursor({ id: cursor })
    .select('id', 'email', 'kind')
    .limit(limit)
    .all();
}
