import type { DemoOrm } from '../prisma/db';

export async function ormClientGetTasks(limit: number, orm: DemoOrm) {
  return orm.Task.limit(limit).all();
}

export async function ormClientGetBugs(limit: number, orm: DemoOrm) {
  return orm.Task.bugs().limit(limit).all();
}

export async function ormClientGetFeatures(limit: number, orm: DemoOrm) {
  return orm.Task.features().limit(limit).all();
}
