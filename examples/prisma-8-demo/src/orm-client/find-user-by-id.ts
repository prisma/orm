import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientFindUserById(id: string, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.User.first({ id });
}
