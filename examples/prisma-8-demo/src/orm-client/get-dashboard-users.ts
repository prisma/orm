import { and, not, or } from '@prisma/orm-postgres/orm-client';
import type { DemoOrm } from '../prisma/db';

export async function ormClientGetDashboardUsers(
  emailDomain: string,
  postTitleTerm: string,
  limit: number,
  postsPerUser: number,
  orm: DemoOrm,
) {
  return await orm.User.where((user) =>
    and(
      or(user.kind.eq('admin'), user.email.ilike(`%@${emailDomain}`)),
      not(user.posts.none((post) => post.title.ilike(`%${postTitleTerm}%`))),
    ),
  )
    .select('id', 'email', 'kind', 'createdAt')
    .include('posts', (post) =>
      post
        .where((p) => p.title.ilike(`%${postTitleTerm}%`))
        .orderBy((p) => p.createdAt.desc())
        .limit(postsPerUser)
        .select('id', 'title', 'createdAt'),
    )
    .orderBy([(user) => user.kind.asc(), (user) => user.createdAt.desc()])
    .limit(limit)
    .all();
}
