import { db } from '../prisma/db';

export async function getUserByEmailPrepared(emails: readonly string[]) {
  const ps = await db.prepare({ email: 'pg/text@1' }, (params) =>
    db.sql.public.user
      .select('id', 'email', 'displayName', 'createdAt', 'kind')
      .where((f, fns) => fns.eq(f.email, params.email))
      .limit(1)
      .build(),
  );

  const runtime = db.runtime();
  const results: Array<{ email: string; user: unknown }> = [];
  for (const email of emails) {
    const rows = await ps.query(runtime, { email });
    results.push({ email, user: rows[0] ?? null });
  }
  return results;
}
