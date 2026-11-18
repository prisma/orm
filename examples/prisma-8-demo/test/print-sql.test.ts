import { describe, expect, it } from 'vitest';
import { db } from '../src/prisma/db';

describe('the demo client', () => {
  it('renders the SQL of a custom collection method without a database', () => {
    const plan = db.orm.public.User.admins().select('id', 'email').prepared.all().plan;

    expect(db.toSql(plan)).toEqual({
      sql: 'SELECT "user"."id" AS "id", "user"."email" AS "email" FROM "public"."user" WHERE "user"."kind" = $1',
      params: ['admin'],
    });
  });
});
