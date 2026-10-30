import type { SqlMiddleware } from '@internal/sql-runtime';
import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import mysql from '../../src/runtime/mysql';
import { contractFromJson } from '../../src/static/contract-from-json';
import { exampleTablesDdl } from '../example-contract';
import type { Contract } from '../fixtures/generated/contract.d';
import contractJson from '../fixtures/generated/contract.json' with { type: 'json' };
import { exampleDatabase, withSeededDatabase } from './live-database';

const contract = contractFromJson<Contract>(contractJson);

function recorder(statements: string[]): SqlMiddleware {
  const record = async (plan: { readonly sql: string }) => {
    statements.push(plan.sql);
    return undefined;
  };
  return { name: 'statement-recorder', intercept: { onQuery: record, onExecute: record } };
}

describe('MySQL writes through the ORM', { timeout: timeouts.databaseOperation }, () => {
  it('creates a row and reads it back by the id MySQL generated', async (test) => {
    await withSeededDatabase(test, exampleTablesDdl, async (url) => {
      const statements: string[] = [];
      await using db = mysql({
        contract,
        url,
        verifyMarker: false,
        middleware: [recorder(statements)],
      });
      expect(await db.orm.User.create({ email: 'a@example.com', role: 'USER' })).toEqual({
        id: 1,
        email: 'a@example.com',
        role: 'USER',
      });
      expect(statements).toEqual([
        'INSERT INTO `User` (`email`, `role`) VALUES (?1, ?2)',
        'SELECT `User`.`email` AS `email`, `User`.`id` AS `id`, `User`.`role` AS `role`, `User`.`id` AS `__written_key_id` FROM `User` WHERE `User`.`id` = ?1',
      ]);
    });
  });

  it('creates rows with and without generated ids, and refuses to return several generated ids', async (test) => {
    await withSeededDatabase(test, exampleTablesDdl, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      const rows = [
        { email: 'a@example.com', role: 'USER' },
        { email: 'b@example.com', role: 'ADMIN' },
      ] as const;
      expect(() => db.orm.User.createAll(rows)).toThrow(
        expect.objectContaining({ code: 'ORM.CAPABILITY_MISSING' }),
      );
      expect({
        counted: await db.orm.User.createAndCount(rows),
        explicit: await db.orm.User.createAll([
          { id: 10, email: 'c@example.com', role: 'USER' },
          { id: 11, email: 'd@example.com', role: 'USER' },
        ]),
        one: await db.orm.User.createAll([{ email: 'e@example.com', role: 'USER' }]),
      }).toEqual({
        counted: 2,
        explicit: [
          { id: 10, email: 'c@example.com', role: 'USER' },
          { id: 11, email: 'd@example.com', role: 'USER' },
        ],
        one: [{ id: 12, email: 'e@example.com', role: 'USER' }],
      });
    });
  });

  it('createAll returns the rows in the order it was given them, not in key order', async (test) => {
    await withSeededDatabase(test, exampleTablesDdl, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      expect(
        (
          await db.orm.User.createAll([
            { id: 12, email: 'c@example.com', role: 'USER' },
            { id: 11, email: 'b@example.com', role: 'USER' },
            { id: 10, email: 'a@example.com', role: 'USER' },
          ])
        ).map((user) => user.id),
      ).toEqual([12, 11, 10]);
    });
  });

  it('creates a user with posts, passing the generated id to them', async (test) => {
    await withSeededDatabase(test, exampleTablesDdl, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      expect(
        await db.orm.User.include('posts', (post) =>
          post.select('title').orderBy((p) => p.id.asc()),
        ).create({
          email: 'a@example.com',
          role: 'USER',
          posts: (posts) => posts.create([{ title: 'First' }, { title: 'Second' }]),
        }),
      ).toEqual({
        id: 1,
        email: 'a@example.com',
        role: 'USER',
        posts: [{ title: 'First' }, { title: 'Second' }],
      });
      expect(
        await db.orm.Post.create({
          title: 'Third',
          author: (author) => author.create({ email: 'b@example.com', role: 'ADMIN' }),
        }),
      ).toEqual({ id: 3, title: 'Third', authorId: 2 });
    });
  });

  it('updates, upserts and deletes as the project example does', async (test) => {
    await withSeededDatabase(test, exampleTablesDdl, async (url) => {
      const statements: string[] = [];
      await using db = mysql({
        contract,
        url,
        verifyMarker: false,
        middleware: [recorder(statements)],
      });
      const user = await db.orm.User.create({ email: 'a@example.com', role: 'USER' });
      const upsertAdmin = () =>
        db.orm.User.upsert({
          create: { email: 'a@example.com', role: 'USER' },
          update: { role: 'ADMIN' },
          conflictOn: { email: 'a@example.com' },
        });
      expect({
        updated: await db.orm.User.where({ id: user.id }).update({ role: 'ADMIN' }),
        missing: await db.orm.User.where({ id: 99 }).update({ role: 'ADMIN' }),
        upserted: await upsertAdmin(),
        created: await db.orm.User.upsert({
          create: { email: 'b@example.com', role: 'USER' },
          update: {},
          conflictOn: { email: 'b@example.com' },
        }),
        existing: await db.orm.User.upsert({
          create: { email: 'b@example.com', role: 'ADMIN' },
          update: {},
          conflictOn: { email: 'b@example.com' },
        }),
        counted: await db.orm.User.where({ role: 'USER' }).updateAndCount({ role: 'ADMIN' }),
        deleted: await db.orm.User.where({ id: user.id }).delete(),
        remaining: await db.orm.User.select('email', 'role').all(),
      }).toEqual({
        updated: { id: 1, email: 'a@example.com', role: 'ADMIN' },
        missing: null,
        upserted: { id: 1, email: 'a@example.com', role: 'ADMIN' },
        created: { id: 3, email: 'b@example.com', role: 'USER' },
        existing: { id: 3, email: 'b@example.com', role: 'USER' },
        counted: 1,
        deleted: { id: 1, email: 'a@example.com', role: 'ADMIN' },
        remaining: [{ email: 'b@example.com', role: 'ADMIN' }],
      });
      expect(statements).toContain(
        'INSERT INTO `User` (`email`, `role`) VALUES (?1, ?2) AS `new` ON DUPLICATE KEY UPDATE `role` = ?3',
      );
    });
  });

  it('updates and deletes every matching row and returns them', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      expect({
        updated: await db.orm.Post.where({ authorId: 1 })
          .select('id', 'title')
          .orderBy((post) => post.id.asc())
          .updateAll({ title: 'Edited' }),
        deleted: await db.orm.Post.where({ title: 'Edited' })
          .select('id')
          .orderBy((post) => post.id.asc())
          .deleteAll(),
        deletedCount: await db.orm.Post.where({ authorId: 2 }).deleteAndCount(),
        remaining: await db.orm.Post.all(),
      }).toEqual({
        updated: [
          { id: 1, title: 'Edited' },
          { id: 2, title: 'Edited' },
          { id: 3, title: 'Edited' },
        ],
        deleted: [{ id: 1 }, { id: 2 }, { id: 3 }],
        deletedCount: 1,
        remaining: [],
      });
    });
  });

  it('updateAll does not overwrite a row another writer moved out of its filter after it selected the rows', async (test) => {
    await withSeededDatabase(test, exampleDatabase, async (url, other) => {
      const movesPostOneFirst: SqlMiddleware = {
        name: 'concurrent-writer',
        intercept: {
          async onExecute(plan) {
            if (plan.sql.startsWith('UPDATE')) {
              await other.query('UPDATE `Post` SET `authorId` = 2 WHERE `id` = 1');
            }
            return undefined;
          },
        },
      };
      await using db = mysql({
        contract,
        url,
        verifyMarker: false,
        middleware: [movesPostOneFirst],
      });
      const returned = await db.orm.Post.where({ authorId: 1 })
        .orderBy((post) => post.id.asc())
        .updateAll({ title: 'Edited' });
      expect({
        returned,
        stored: await db.orm.Post.orderBy((post) => post.id.asc()).all(),
      }).toEqual({
        returned: [
          { id: 1, title: 'Alpha', authorId: 2 },
          { id: 2, title: 'Edited', authorId: 1 },
          { id: 3, title: 'Edited', authorId: 1 },
        ],
        stored: [
          { id: 1, title: 'Alpha', authorId: 2 },
          { id: 2, title: 'Edited', authorId: 1 },
          { id: 3, title: 'Edited', authorId: 1 },
          { id: 4, title: 'Delta', authorId: 2 },
        ],
      });
    });
  });

  it('an upsert that collides on a unique index the contract does not list, while no row has the conflict values, fails and rolls back', async (test) => {
    const seeded = [
      ...exampleTablesDdl,
      "INSERT INTO `User` (`id`, `email`, `role`) VALUES (1, 'a@example.com', 'USER')",
      'CREATE UNIQUE INDEX `User_role_key` ON `User` (`role`)',
    ];
    await withSeededDatabase(test, seeded, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      await expect(
        db.orm.User.upsert({
          create: { email: 'new@example.com', role: 'USER' },
          update: { role: 'ADMIN' },
          conflictOn: { email: 'new@example.com' },
        }),
      ).rejects.toMatchObject({
        code: 'ORM.MUTATION_ROW_MISSING',
        message: 'upsert() for model "User" did not find the row it wrote',
      });
      expect(await db.orm.User.all()).toEqual([{ id: 1, email: 'a@example.com', role: 'USER' }]);
    });
  });

  it('known gap: an upsert that collides on an unlisted unique index while a row has the conflict values updates the other row and succeeds', async (test) => {
    const seeded = [
      `CREATE TABLE \`User\` (
        \`id\` int NOT NULL AUTO_INCREMENT,
        \`handle\` varchar(20) NOT NULL DEFAULT 'h',
        \`email\` varchar(191) NOT NULL,
        \`role\` enum('USER','ADMIN') NOT NULL,
        PRIMARY KEY (\`id\`),
        UNIQUE KEY \`User_handle_key\` (\`handle\`),
        UNIQUE KEY \`User_email_key\` (\`email\`)
      )`,
      "INSERT INTO `User` (`id`, `handle`, `email`, `role`) VALUES (1, 'h', 'a@example.com', 'USER'), (2, 'other', 'b@example.com', 'USER')",
    ];
    await withSeededDatabase(test, seeded, async (url) => {
      await using db = mysql({ contract, url, verifyMarker: false });
      expect({
        returned: await db.orm.User.upsert({
          create: { email: 'b@example.com', role: 'USER' },
          update: { role: 'ADMIN' },
          conflictOn: { email: 'b@example.com' },
        }),
        stored: await db.orm.User.orderBy((user) => user.id.asc()).all(),
      }).toEqual({
        returned: { id: 2, email: 'b@example.com', role: 'USER' },
        stored: [
          { id: 1, email: 'a@example.com', role: 'ADMIN' },
          { id: 2, email: 'b@example.com', role: 'USER' },
        ],
      });
    });
  });

  it('a create fails with ORM.MUTATION_ROW_MISSING and rolls back when a middleware answers its insert without an insert id', async (test) => {
    const answersPostInserts: SqlMiddleware = {
      name: 'answers-post-inserts',
      intercept: {
        async onExecute(plan) {
          return plan.sql.startsWith('INSERT INTO `Post`')
            ? { stats: { affectedRows: 1 } }
            : undefined;
        },
      },
    };
    await withSeededDatabase(test, exampleTablesDdl, async (url) => {
      await using db = mysql({
        contract,
        url,
        verifyMarker: false,
        middleware: [answersPostInserts],
      });
      await expect(
        db.orm.Post.create({
          title: 'Hello',
          author: (author) => author.create({ email: 'a@example.com', role: 'USER' }),
        }),
      ).rejects.toMatchObject({
        code: 'ORM.MUTATION_ROW_MISSING',
        meta: expect.objectContaining({ phase: 'insert-id' }),
      });
      expect(await db.orm.User.all()).toEqual([]);
    });
  });
});
