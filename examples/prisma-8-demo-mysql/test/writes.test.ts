import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import {
  createUser,
  deleteUser,
  promoteEveryUser,
  promoteUser,
  upsertAdmin,
} from '../src/orm-client/user-writes';
import { createDb, type Db } from '../src/prisma/db';
import { copyProject, prisma } from './cli';
import { createTestDatabase, type TestDatabase } from './database';

const serverUrl = process.env['MYSQL_URL'];

describe.skipIf(serverUrl === undefined)('ORM writes against a migrated MySQL database', () => {
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
  });

  afterAll(async () => {
    await db?.close();
    await database?.drop();
  });

  it('creates, updates, upserts, counts and deletes users, each returning what it returns on Postgres', async () => {
    const user = await createUser(db, 'a@example.com');
    expect({
      user,
      promoted: await promoteUser(db, user.id),
      upserted: await upsertAdmin(db, 'b@example.com'),
      upsertedAgain: await upsertAdmin(db, 'b@example.com'),
      counted: await promoteEveryUser(db),
      deleted: await deleteUser(db, user.id),
      missing: await deleteUser(db, user.id),
      remaining: await db.orm.User.all(),
    }).toEqual({
      user: { id: 1, email: 'a@example.com', role: 'USER' },
      promoted: { id: 1, email: 'a@example.com', role: 'ADMIN' },
      upserted: { id: 2, email: 'b@example.com', role: 'USER' },
      upsertedAgain: { id: 2, email: 'b@example.com', role: 'ADMIN' },
      counted: 0,
      deleted: { id: 1, email: 'a@example.com', role: 'ADMIN' },
      missing: null,
      remaining: [{ id: 2, email: 'b@example.com', role: 'ADMIN' }],
    });
  });
});
