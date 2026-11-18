import type { DemoOrm } from '../prisma/db';

export async function ormClientFindUserByEmail(email: string, orm: DemoOrm) {
  return orm.User.byEmail(email).first();
}
