import type { DemoOrm } from '../prisma/db';

export async function ormClientGetLatestUserPerKind(orm: DemoOrm) {
  return orm.User.orderBy([
    (user) => user.kind.asc(),
    (user) => user.createdAt.desc(),
    (user) => user.id.asc(),
  ])
    .distinctOn('kind')
    .select('id', 'email', 'kind', 'createdAt')
    .all();
}
