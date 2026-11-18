import type { DemoOrm } from '../prisma/db';

export async function ormClientGetUsers(limit: number, orm: DemoOrm) {
  return orm.User.limit(limit).all();
}
