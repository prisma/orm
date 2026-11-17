import type { DemoOrm } from '../prisma/db';

export async function ormClientFindUserById(id: string, orm: DemoOrm) {
  return orm.User.first({ id });
}
