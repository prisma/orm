import { db } from '../prisma/db';

const Priority = db.enums.public.Priority;

export async function getPostsByPriority(limit = 10) {
  const plan = db.sql.public.post
    .select('id', 'title', 'priority')
    .orderBy('priority')
    .orderBy('id')
    .limit(limit)
    .build();
  return db.query(plan);
}

export async function getPostsByPriorityMember(priority: typeof Priority.Value, limit = 10) {
  const plan = db.sql.public.post
    .select('id', 'title', 'priority')
    .where((cols, ops) => ops.eq(cols.priority, priority))
    .orderBy('id')
    .limit(limit)
    .build();
  return db.query(plan);
}
