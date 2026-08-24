import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetTasks(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Task.limit(limit).all();
}

export async function ormClientGetBugs(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Task.bugs().limit(limit).all();
}

export async function ormClientGetFeatures(limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Task.features().limit(limit).all();
}
