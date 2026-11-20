import { timeouts } from '@repo/test-utils';
import { describe, expect, it } from 'vitest';
import { exampleDatabase, withSeededDatabase } from '../live-database';
import type { LiveServer } from '../live-server';

const awkwardText = 'it\'s "quoted", a \\ backslash, ünïcödé and 🙂';

const notesDatabase = [
  'CREATE TABLE `Author` (`id` int NOT NULL, PRIMARY KEY (`id`))',
  'CREATE TABLE `Note` (`id` int NOT NULL, `body` varchar(191) NOT NULL, `summary` varchar(191) NULL, `authorId` int NOT NULL, PRIMARY KEY (`id`)) DEFAULT CHARSET = utf8mb4',
  'INSERT INTO `Author` VALUES (1)',
  `INSERT INTO \`Note\` VALUES (1, '${awkwardText.replace(/\\/g, '\\\\').replace(/'/g, "''")}', NULL, 1), (2, 'plain', 'short', 1)`,
] as const;

const eventsDatabase = [
  'CREATE TABLE `Account` (`id` int NOT NULL, `name` varchar(191) NOT NULL, PRIMARY KEY (`id`))',
  'CREATE TABLE `Event` (`id` bigint NOT NULL, `at` datetime(3) NOT NULL, `accountId` int NOT NULL, PRIMARY KEY (`id`))',
  "INSERT INTO `Account` VALUES (1, 'main')",
  "INSERT INTO `Event` VALUES (9007199254740993, '2024-01-02 03:04:05.678', 1), (2, '2024-01-02 03:04:05.000', 1)",
] as const;

export function describeOrmIncludes(server: LiveServer): void {
  describe(`${server.displayName} includes through the ORM`, {
    timeout: timeouts.databaseOperation,
  }, () => {
    it('includes the row a to-one relation points at', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const posts = await db.orm.Post.select('id', 'title')
          .include('author', (author) => author.select('id', 'email'))
          .orderBy((p) => p.id.asc())
          .all();
        expect(posts).toEqual([
          { id: 1, title: 'Alpha', author: { id: 1, email: 'b@example.com' } },
          { id: 2, title: 'Gamma', author: { id: 1, email: 'b@example.com' } },
          { id: 3, title: 'Beta', author: { id: 1, email: 'b@example.com' } },
          { id: 4, title: 'Delta', author: { id: 2, email: 'a@example.com' } },
        ]);
      });
    });

    it('carries an enum column through an include as its member', async (test) => {
      await withSeededDatabase(
        test,
        server,
        [
          ...exampleDatabase,
          "INSERT INTO `Post` (`id`, `title`, `authorId`) VALUES (5, 'Epsilon', 3)",
        ],
        async (url) => {
          await using db = server.client({ url, verifyMarker: false });
          const posts = await db.orm.Post.select('id')
            .include('author', (author) => author.select('role'))
            .where((p) => p.id.gte(4))
            .orderBy((p) => p.id.asc())
            .all();
          expect(posts).toEqual([
            { id: 4, author: { role: 'ADMIN' } },
            { id: 5, author: { role: 'USER' } },
          ]);
        },
      );
    });

    it('keeps a to-many include in the order it asks for, both ways', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const withPosts = (dir: 'asc' | 'desc') =>
          db.orm.User.select('id')
            .include('posts', (posts) =>
              posts
                .select('title')
                .orderBy((p) => (dir === 'asc' ? p.title.asc() : p.title.desc())),
            )
            .first({ id: 1 });
        expect({ desc: await withPosts('desc'), asc: await withPosts('asc') }).toEqual({
          desc: { id: 1, posts: [{ title: 'Gamma' }, { title: 'Beta' }, { title: 'Alpha' }] },
          asc: { id: 1, posts: [{ title: 'Alpha' }, { title: 'Beta' }, { title: 'Gamma' }] },
        });
      });
    });

    it('limits and skips the rows of a to-many include', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const user = await db.orm.User.select('id')
          .include('posts', (posts) =>
            posts
              .select('title')
              .orderBy((p) => p.title.asc())
              .offset(1)
              .limit(1),
          )
          .first({ id: 1 });
        expect(user).toEqual({ id: 1, posts: [{ title: 'Beta' }] });
      });
    });

    it('includes two levels deep, and an empty to-many include as an empty array', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const users = await db.orm.User.select('id')
          .include('posts', (posts) =>
            posts
              .select('title')
              .orderBy((p) => p.id.desc())
              .include('author', (author) => author.select('email')),
          )
          .orderBy((u) => u.id.asc())
          .all();
        expect(users).toEqual([
          {
            id: 1,
            posts: [
              { title: 'Beta', author: { email: 'b@example.com' } },
              { title: 'Gamma', author: { email: 'b@example.com' } },
              { title: 'Alpha', author: { email: 'b@example.com' } },
            ],
          },
          { id: 2, posts: [{ title: 'Delta', author: { email: 'a@example.com' } }] },
          { id: 3, posts: [] },
          { id: 4, posts: [] },
        ]);
      });
    });

    it('returns an ordered include longer than the session group_concat_max_len in full', async (test) => {
      const titles = Array.from(
        { length: 40 },
        (_, i) => `post ${String(i).padStart(2, '0')} ${'x'.repeat(60)}`,
      );
      const rows = titles.map((title, i) => `(${i + 1}, '${title}', 1)`).join(', ');
      await withSeededDatabase(
        test,
        server,
        [
          ...exampleDatabase.slice(0, 3),
          `INSERT INTO \`Post\` (\`id\`, \`title\`, \`authorId\`) VALUES ${rows}`,
        ],
        async (url) => {
          await using db = server.client({ url, verifyMarker: false });
          const user = await db.orm.User.select('id')
            .include('posts', (posts) => posts.select('title').orderBy((p) => p.title.desc()))
            .first({ id: 1 });
          expect(user).toEqual({ id: 1, posts: [...titles].reverse().map((title) => ({ title })) });
        },
      );
    });

    it('fails, rather than returning an empty array, or returns every row, as the server is expected to, when an ordered include is larger than a packet', async (test) => {
      await withSeededDatabase(
        test,
        server,
        [
          "CREATE TABLE `User` (`id` int NOT NULL, `email` varchar(191) NOT NULL, `role` enum('USER','ADMIN') NOT NULL, PRIMARY KEY (`id`))",
          'CREATE TABLE `Post` (`id` int NOT NULL, `title` longtext NOT NULL, `authorId` int NOT NULL, PRIMARY KEY (`id`))',
          "INSERT INTO `User` VALUES (1, 'b@example.com', 'ADMIN')",
          "INSERT INTO `Post` (`id`, `title`, `authorId`) WITH RECURSIVE s(n) AS (SELECT 1 UNION ALL SELECT n + 1 FROM s WHERE n < 70) SELECT n, REPEAT('x', 1000000), 1 FROM s",
        ],
        async (url) => {
          await using db = server.client({ url, verifyMarker: false });
          const user = db.orm.User.select('id')
            .include('posts', (posts) => posts.select('title').orderBy((p) => p.id.asc()))
            .first({ id: 1 });
          const outcome = await user.then(
            (read) => ({
              posts: read?.posts.length,
              lengths: new Set(read?.posts.map((post) => post.title.length)),
            }),
            (error: unknown) => String(Object(error).message),
          );
          expect(outcome).toEqual(
            server.expected.oversizedOrderedInclude === 'fails'
              ? expect.stringMatching(/Invalid JSON text/)
              : { posts: 70, lengths: new Set([1000000]) },
          );
        },
      );
    });

    it('returns whole rows for a user with its posts in order and for posts with their author', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const withPosts = await db.orm.User.include('posts', (posts) =>
          posts.orderBy((p) => p.title.desc()),
        ).first({ id: 1 });
        const authors = await db.orm.Post.include('author')
          .orderBy((p) => p.id.asc())
          .all();
        const b = { id: 1, email: 'b@example.com', role: 'ADMIN' };
        const a = { id: 2, email: 'a@example.com', role: 'ADMIN' };
        expect({ withPosts, authors }).toEqual({
          withPosts: {
            ...b,
            posts: [
              { id: 2, title: 'Gamma', authorId: 1 },
              { id: 3, title: 'Beta', authorId: 1 },
              { id: 1, title: 'Alpha', authorId: 1 },
            ],
          },
          authors: [
            { id: 1, title: 'Alpha', authorId: 1, author: b },
            { id: 2, title: 'Gamma', authorId: 1, author: b },
            { id: 3, title: 'Beta', authorId: 1, author: b },
            { id: 4, title: 'Delta', authorId: 2, author: a },
          ],
        });
      });
    });

    it('carries text with quotes, backslashes and non-ASCII characters, and a NULL, through an include unchanged', async (test) => {
      await withSeededDatabase(test, server, notesDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const author = await db.orm.Author.select('id')
          .include('notes', (notes) => notes.select('body', 'summary').orderBy((n) => n.id.asc()))
          .first({ id: 1 });
        expect(author).toEqual({
          id: 1,
          notes: [
            { body: awkwardText, summary: null },
            { body: 'plain', summary: 'short' },
          ],
        });
      });
    });

    it('includes three levels deep', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const user = await db.orm.User.select('id')
          .include('posts', (posts) =>
            posts
              .select('title')
              .orderBy((p) => p.id.asc())
              .include('author', (author) =>
                author
                  .select('email')
                  .include('posts', (again) => again.select('id').orderBy((p) => p.id.desc())),
              ),
          )
          .first({ id: 2 });
        expect(user).toEqual({
          id: 2,
          posts: [{ title: 'Delta', author: { email: 'a@example.com', posts: [{ id: 4 }] } }],
        });
      });
    });

    it('reduces a to-many include to count, sum, avg, min and max', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const reduced = async (user: number) => ({
          count: await db.orm.User.include('posts', (p) => p.count()).first({ id: user }),
          sum: await db.orm.User.include('posts', (p) => p.sum('id')).first({ id: user }),
          avg: await db.orm.User.include('posts', (p) => p.avg('id')).first({ id: user }),
          min: await db.orm.User.include('posts', (p) => p.min('title')).first({ id: user }),
          max: await db.orm.User.include('posts', (p) => p.max('title')).first({ id: user }),
        });
        const posts = async (user: number) =>
          Object.fromEntries(
            Object.entries(await reduced(user)).map(([name, row]) => [name, row?.posts]),
          );
        expect({ withPosts: await posts(1), without: await posts(3) }).toEqual({
          withPosts: { count: 3, sum: 6, avg: 2, min: 'Alpha', max: 'Gamma' },
          without: { count: 0, sum: null, avg: null, min: null, max: null },
        });
      });
    });

    it('reads the mean of integers exactly, whether or not the join column has an index', async (test) => {
      await withSeededDatabase(
        test,
        server,
        [
          ...exampleDatabase,
          "INSERT INTO `Post` (`id`, `title`, `authorId`) VALUES (5, 'Epsilon', 2), (7, 'Eta', 2)",
          ...notesDatabase,
          "INSERT INTO `Note` VALUES (4, 'more', NULL, 1)",
          'INSERT INTO `Author` VALUES (2)',
          "INSERT INTO `Note` VALUES (3, 'x', NULL, 2), (5, 'y', NULL, 2), (6, 'z', NULL, 2)",
        ],
        async (url) => {
          await using db = server.client({ url, verifyMarker: false });
          expect({
            indexed: await db.orm.User.select('id')
              .include('posts', (p) => p.avg('id'))
              .first({ id: 2 }),
            unindexed: await db.orm.Author.select('id')
              .include('notes', (n) => n.avg('id'))
              .orderBy((a) => a.id.asc())
              .all(),
          }).toEqual({
            indexed: { id: 2, posts: 16 / 3 },
            unindexed: [
              { id: 1, notes: 7 / 3 },
              { id: 2, notes: 14 / 3 },
            ],
          });
        },
      );
    });

    it('reads a sum past 2^53 exactly through sumBigInt, and refuses it as a number rather than round it', async (test) => {
      await withSeededDatabase(test, server, eventsDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const exact = await db.orm.Account.select('id')
          .include('events', (events) => events.sumBigInt('id'))
          .first({ id: 1 });
        expect(exact).toEqual({ id: 1, events: 9007199254740995n });
        await expect(
          db.orm.Account.select('id')
            .include('events', (events) => events.sum('id'))
            .first({ id: 1 }),
        ).rejects.toMatchObject({ code: 'RUNTIME.DECODE_FAILED' });
      });
    });

    it('combines the rows of a to-many include with a count of them', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const users = await db.orm.User.select('id')
          .include('posts', (posts) =>
            posts.combine({
              rows: posts
                .select('title')
                .orderBy((p) => p.title.asc())
                .limit(2),
              count: posts.count(),
            }),
          )
          .where((u) => u.id.lte(3))
          .orderBy((u) => u.id.asc())
          .all();
        expect(users).toEqual([
          { id: 1, posts: { rows: [{ title: 'Alpha' }, { title: 'Beta' }], count: 3 } },
          { id: 2, posts: { rows: [{ title: 'Delta' }], count: 1 } },
          { id: 3, posts: { rows: [], count: 0 } },
        ]);
      });
    });

    it('counts the posts of the author of each post, two levels deep', async (test) => {
      await withSeededDatabase(test, server, exampleDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const posts = await db.orm.Post.select('id')
          .include('author', (author) =>
            author.select('email').include('posts', (again) => again.count()),
          )
          .where((p) => p.id.gte(3))
          .orderBy((p) => p.id.asc())
          .all();
        expect(posts).toEqual([
          { id: 3, author: { email: 'b@example.com', posts: 3 } },
          { id: 4, author: { email: 'a@example.com', posts: 1 } },
        ]);
      });
    });

    it('keeps a bigint past 2^53 and a datetime(3) exact inside an include', async (test) => {
      await withSeededDatabase(test, server, eventsDatabase, async (url) => {
        await using db = server.client({ url, verifyMarker: false });
        const account = await db.orm.Account.select('id')
          .include('events', (events) => events.select('id', 'at').orderBy((e) => e.id.desc()))
          .first({ id: 1 });
        expect(account).toEqual({
          id: 1,
          events: [
            { id: 9007199254740993n, at: new Date('2024-01-02T03:04:05.678Z') },
            { id: 2n, at: new Date('2024-01-02T03:04:05.000Z') },
          ],
        });
      });
    });
  });
}
