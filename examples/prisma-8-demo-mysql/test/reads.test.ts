import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { getAdmins } from '../src/orm-client/get-admins';
import { getPostsWithAuthors } from '../src/orm-client/get-posts-with-authors';
import { getUserWithPosts } from '../src/orm-client/get-user-with-posts';
import { getUsersWithPostAuthors } from '../src/orm-client/get-users-with-post-authors';
import { createDb, type Db } from '../src/prisma/db';
import { getAdminEmails } from '../src/queries/get-admin-emails';
import { seed } from '../src/seed';
import { copyProject, prisma } from './cli';
import { createTestDatabase, type TestDatabase } from './database';

const serverUrl = process.env['MYSQL_URL'];

const ada = { id: 1, email: 'ada@example.com', role: 'ADMIN' };
const bea = { id: 2, email: 'bea@example.com', role: 'USER' };

describe.skipIf(serverUrl === undefined)(
  'reads against a migrated and seeded MySQL database',
  () => {
    let database: TestDatabase;
    let db: Db;

    beforeAll(async () => {
      database = await createTestDatabase(serverUrl ?? '');
      const project = await copyProject();
      try {
        const migrate = await prisma(project.dir, database.url, ['db', 'migrate']);
        expect(migrate.exitCode).toBe(0);
      } finally {
        await project.remove();
      }
      db = createDb(database.url);
      await seed(db);
    });

    afterAll(async () => {
      await db?.close();
      await database?.drop();
    });

    it('filters, orders and limits', async () => {
      expect(await getAdmins(db, 2)).toEqual([
        ada,
        { id: 3, email: 'cy@example.com', role: 'ADMIN' },
      ]);
    });

    it('returns a to-many include in the order it asks for', async () => {
      expect(await getUserWithPosts(db, 1)).toEqual({
        ...ada,
        posts: [
          { id: 2, title: 'Ordered includes', authorId: 1 },
          { id: 3, title: 'Joins without LATERAL', authorId: 1 },
          { id: 1, title: 'Hello MySQL', authorId: 1 },
        ],
      });
    });

    it('includes the row a to-one relation points at', async () => {
      expect(await getPostsWithAuthors(db)).toEqual([
        { id: 1, title: 'Hello MySQL', authorId: 1, author: ada },
        { id: 2, title: 'Ordered includes', authorId: 1, author: ada },
        { id: 3, title: 'Joins without LATERAL', authorId: 1, author: ada },
        { id: 4, title: 'First post', authorId: 2, author: bea },
      ]);
    });

    it('includes two levels deep, and a user with no posts gets an empty array', async () => {
      const byAda = { email: 'ada@example.com' };
      expect(await getUsersWithPostAuthors(db)).toEqual([
        {
          email: 'ada@example.com',
          posts: [
            { title: 'Hello MySQL', author: byAda },
            { title: 'Ordered includes', author: byAda },
            { title: 'Joins without LATERAL', author: byAda },
          ],
        },
        {
          email: 'bea@example.com',
          posts: [{ title: 'First post', author: { email: 'bea@example.com' } }],
        },
        { email: 'cy@example.com', posts: [] },
        { email: 'dot@example.com', posts: [] },
      ]);
    });

    it('selects through the SQL builder', async () => {
      expect(await getAdminEmails(db)).toEqual([
        { id: 1, email: 'ada@example.com' },
        { id: 3, email: 'cy@example.com' },
        { id: 4, email: 'dot@example.com' },
      ]);
    });
  },
);
