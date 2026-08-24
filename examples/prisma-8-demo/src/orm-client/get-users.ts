import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetUsers(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.limit(limit).all();
}
