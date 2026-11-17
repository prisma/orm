import type { DemoOrm } from '../prisma/db';

export async function ormClientGetAdminUsers(limit: number, orm: DemoOrm) {
  return orm.User.admins().limit(limit).all();
}
