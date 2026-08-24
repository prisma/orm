import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetAdminUsers(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.admins().limit(limit).all();
}
