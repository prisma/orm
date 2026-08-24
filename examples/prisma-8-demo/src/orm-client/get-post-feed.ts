import type { Runtime } from '@prisma/orm-postgres/family-runtime';
import { createOrmClient } from './client';

export async function ormClientGetPostFeed(titleTerm: string, limit: number, runtime: Runtime) {
  const db = createOrmClient(runtime);
  return db.Post.withTitle(titleTerm)
    .select('id', 'title', 'userId', 'createdAt')
    .include('user', (user) => user.select('id', 'email', 'kind'))
    .orderBy([(post) => post.createdAt.desc(), (post) => post.id.asc()])
    .limit(limit)
    .all();
}
