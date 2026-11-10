import type { DemoOrm } from '../prisma/db';

export async function ormClientGetPostFeed(titleTerm: string, limit: number, orm: DemoOrm) {
  return orm.Post.withTitle(titleTerm)
    .select('id', 'title', 'userId', 'createdAt')
    .include('user', (user) => user.select('id', 'email', 'kind'))
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.asc()])
    .limit(limit)
    .all();
}
